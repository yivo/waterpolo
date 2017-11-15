var Pull;

Pull = (function() {
  function Pull(count, callback, time, options) {
    this.count = count;
    this.callback = callback;
    this.time = time;
    this.options = options;
  }

  module.exports = Pull;

  return Pull;

})();
