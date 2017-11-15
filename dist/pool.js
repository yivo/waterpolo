var AUTO_LOG_LEVEL, DEFAULTS, LOG_DEBUG, LOG_ERROR, LOG_FATAL, LOG_INFO, LOG_LEVEL, LOG_WARN, OPTIONS, Pool, _, pluralize, ref,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

_ = {
  defaults: require('lodash/defaults'),
  extend: require('lodash/extend'),
  bindAll: require('lodash/bindAll'),
  sumBy: require('lodash/sumBy'),
  padEnd: require('lodash/padEnd'),
  times: require('lodash/times'),
  pick: require('lodash/pick'),
  values: require('lodash/values'),
  without: require('lodash/without'),
  take: require('lodash/take'),
  min: require('lodash/min'),
  now: require('lodash/now'),
  filter: require('lodash/filter'),
  drop: require('lodash/drop'),
  take: require('lodash/take')
};

AUTO_LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'warn' : 'debug';

LOG_LEVEL = (ref = process.env.WATERPOOL_LOG_LEVEL) != null ? ref : AUTO_LOG_LEVEL;

LOG_DEBUG = LOG_LEVEL === 'debug';

LOG_INFO = LOG_DEBUG || LOG_LEVEL === 'info';

LOG_WARN = LOG_INFO || LOG_LEVEL === 'warn';

LOG_ERROR = LOG_WARN || LOG_LEVEL === 'error';

LOG_FATAL = LOG_ERROR || LOG_LEVEL === 'fatal';

OPTIONS = ['name', 'prefetch', 'capacity', 'concurrency', 'fetchTimeout', 'fulfillTimeout', 'Pull'];

if (typeof OPTIONS.freeze === "function") {
  OPTIONS.freeze();
}

DEFAULTS = {
  name: 'Pool',
  prefetch: 0,
  capacity: 1,
  concurrency: 1,
  fetchTimeout: 0,
  fulfillTimeout: 0,
  Pull: require('./pull')
};

pluralize = function(singular, n) {
  if (n === 1) {
    return singular;
  } else {
    return singular + 's';
  }
};

Pool = (function() {
  function Pool(source, objects1, options) {
    this.source = source;
    this.objects = objects1 != null ? objects1 : [];
    if (options == null) {
      options = {};
    }
    this.pulls = [];
    this.fetching = 0;
    this.size = this.objects.length;
    _.defaults(options, DEFAULTS);
    _.extend(this, _.pick(options, OPTIONS));
    this.prefix = "[" + this.name + "] ";
    _.bindAll(this, 'pull', 'fetch', 'load', 'fulfill');
    process.nextTick(this.fetch);
  }

  Pool.prototype.id = function(object) {
    throw new Error(this.prefix + ("Please, implement " + this.constructor.name + "#id(object)."));
  };

  Pool.prototype.log = function(message) {
    return console.log(this.prefix + message);
  };

  Pool.prototype.fetch = function() {
    var demand, fetched, lacks, n, room, slots;
    slots = this.concurrency - this.fetching;
    if (slots < 1) {
      if (LOG_INFO) {
        this.log("No slots available.");
      }
      return this;
    }
    fetched = this.size + this.fetching;
    room = this.capacity - fetched;
    demand = _.sumBy(this.pulls, 'count');
    lacks = demand - fetched;
    if (room < 1) {
      if (LOG_INFO) {
        this.log("Pool is full.");
      }
      return this;
    }
    if (lacks > 0) {
      n = lacks;
    } else if (this.prefetch > 0 && fetched < this.prefetch) {
      n = this.prefetch - fetched;
    } else {
      return this;
    }
    n = _.min([n, slots]);
    n = _.min([n, room]);
    if (LOG_INFO) {
      this.log("Fetching " + n + " " + (pluralize('object', n)) + ".");
    }
    _.times(n, this.load);
    return this;
  };

  Pool.prototype.load = function() {
    var safeguard, startedAt, timeouted, timerID;
    startedAt = _.now();
    timeouted = false;
    if ((this.fetchTimeout != null) && this.fetchTimeout !== 0) {
      safeguard = (function(_this) {
        return function() {
          --_this.fetching;
          timeouted = true;
          process.nextTick(_this.fulfill);
          if (LOG_INFO) {
            return _this.log("Fetch timeouted in " + (_.now() - startedAt) + " ms.");
          }
        };
      })(this);
      timerID = setTimeout(safeguard, this.fetchTimeout);
    }
    ++this.fetching;
    return this.source.load((function(_this) {
      return function(error, objects) {
        var i, len, object;
        process.nextTick(_this.fulfill);
        if (timeouted) {
          return;
        }
        if (timerID != null) {
          clearTimeout(timerID);
        }
        --_this.fetching;
        if (error != null) {
          if (LOG_ERROR) {
            _this.log("Fetch failed: \"" + error + "\".");
          }
          return;
        }
        if (LOG_INFO) {
          _this.log("Fetched " + objects.length + " " + (pluralize('object', objects.length)) + " in " + (_.now() - startedAt) + " ms.");
        }
        for (i = 0, len = objects.length; i < len; i++) {
          object = objects[i];
          _this.push(object, false);
        }
        return null;
      };
    })(this));
  };

  Pool.prototype.push = function(object, fulfill) {
    var i, id, len, other, ref1;
    id = this.id(object);
    ref1 = this.objects;
    for (i = 0, len = ref1.length; i < len; i++) {
      other = ref1[i];
      if (id === this.id(other)) {
        if (LOG_INFO) {
          this.log("Exists " + id + ".");
        }
        return this;
      }
    }
    this.objects.push(object);
    this.size = this.objects.length;
    if (LOG_INFO) {
      this.log("Pushed " + id + ".");
    }
    if (fulfill !== false) {
      process.nextTick(this.fulfill);
    }
    return this;
  };

  Pool.prototype.fulfill = function() {
    var i, j, len, len1, objects, pull, ref1, ref2, ref3, ref4, timeoutID;
    this.fetch();
    ref1 = this.pulls;
    for (i = 0, len = ref1.length; i < len; i++) {
      pull = ref1[i];
      if ((ref2 = pull.options, timeoutID = ref2.timeoutID, ref2) != null) {
        if (pull.callback == null) {
          clearTimeout(timeoutID);
          pull.options.timeoutID = null;
        }
      }
    }
    this.pulls = _.filter(this.pulls, function(arg) {
      var callback;
      callback = arg.callback;
      return callback != null;
    });
    ref3 = this.pulls.slice();
    for (j = 0, len1 = ref3.length; j < len1; j++) {
      pull = ref3[j];
      if (!(pull.count <= this.size)) {
        continue;
      }
      objects = _.take(this.objects, pull.count);
      this.objects = _.drop(this.objects, pull.count);
      this.size = this.objects.length;
      this.pulls = _.without(this.pulls, pull);
      if ((ref4 = pull.options, timeoutID = ref4.timeoutID, ref4) != null) {
        clearTimeout(timeoutID);
        pull.options.timeoutID = null;
      }
      if (LOG_INFO) {
        this.log("Pulled " + pull.count + " " + (pluralize('object', pull.count)) + " in " + (_.now() - pull.time) + " ms.");
      }
      pull.callback(null, objects);
    }
    this.fetch();
    return this;
  };

  Pool.prototype.pull = function(count, x, y) {
    var callback, options, pull, self, time, timeout;
    options = arguments.length > 2 ? x : {};
    callback = arguments.length > 2 ? y : x;
    if (count == null) {
      count = 1;
    }
    timeout = options.timeout != null ? options.timeout : options.timeout = this.fulfillTimeout;
    self = this;
    time = _.now();
    if (LOG_INFO) {
      this.log("Requested " + count + " " + (pluralize('object', count)) + ".");
    }
    this.pulls.push(pull = new this.Pull(count, callback, time, options));
    if ((timeout != null) && timeout !== 0) {
      options.timeoutID = setTimeout(function() {
        var error;
        options.timeoutID = null;
        if ((pull.callback != null) && indexOf.call(self.pulls, pull) >= 0) {
          self.pulls = _.without(self.pulls, pull);
          error = "Pull timeouted in " + (_.now() - time) + " ms.";
          if (LOG_INFO) {
            console.log(self.prefix + error);
          }
          return pull.callback(error);
        }
      }, timeout);
    }
    process.nextTick(this.fulfill);
    return pull;
  };

  module.exports = Pool;

  return Pool;

})();
