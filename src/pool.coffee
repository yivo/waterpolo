_ =
  defaults: require('lodash/defaults')
  extend:   require('lodash/extend')
  bindAll:  require('lodash/bindAll')
  sumBy:    require('lodash/sumBy')
  padEnd:   require('lodash/padEnd')
  times:    require('lodash/times')
  pick:     require('lodash/pick')
  values:   require('lodash/values')
  without:  require('lodash/without')
  take:     require('lodash/take')
  min:      require('lodash/min')
  now:      require('lodash/now')
  filter:   require('lodash/filter')
  drop:     require('lodash/drop')
  take:     require('lodash/take')

AUTO_LOG_LEVEL = if process.env.NODE_ENV is 'production' then 'warn' else 'debug'
LOG_LEVEL      = process.env.WATERPOOL_LOG_LEVEL ? AUTO_LOG_LEVEL
LOG_DEBUG      = LOG_LEVEL is 'debug'
LOG_INFO       = LOG_DEBUG or LOG_LEVEL is 'info'
LOG_WARN       = LOG_INFO  or LOG_LEVEL is 'warn'
LOG_ERROR      = LOG_WARN  or LOG_LEVEL is 'error'
LOG_FATAL      = LOG_ERROR or LOG_LEVEL is 'fatal'

OPTIONS = ['name', 'prefetch', 'capacity', 'concurrency', 'fetchTimeout', 'fulfillTimeout', 'Pull']
OPTIONS.freeze?()

DEFAULTS =
  name:           'Pool'
  prefetch:       0
  capacity:       1
  concurrency:    1
  fetchTimeout:   0
  fulfillTimeout: 0
  Pull:           require('./pull.coffee')

pluralize = (singular, n) ->
  if n is 1 then singular else singular + 's'

class Pool

  constructor: (@source, @objects = [], options = {}) ->
    @pulls    = []
    @fetching = 0
    @size     = @objects.length
    _.defaults options, DEFAULTS
    _.extend this, _.pick(options, OPTIONS)
    @prefix = "[#{@name}] "
    _.bindAll this, 'pull', 'fetch', 'load', 'fulfill'
    process.nextTick(@fetch)

  id: (object) ->
    throw new Error @prefix + "Please, implement #{@constructor.name}#id(object)."

  log: (message) ->
    console.log @prefix + message

  fetch: ->
    slots = @concurrency - @fetching

    # Do not exceed the number of simultaneous requests.
    if slots < 1
      @log "No slots available." if LOG_INFO
      return this

    # Number of fetched objects.
    fetched = @size + @fetching

    # Number of objects which can fit in the pool.
    room = @capacity - fetched

    demand = _.sumBy(@pulls, 'count')

    # Number of objects which are not loaded yet.
    lacks = demand - fetched

    # Wow! You have full pool.
    if room < 1
      @log "Pool is full." if LOG_INFO
      return this

    if lacks > 0
      n = lacks

    # Prefetch if:
    # – it is enabled
    # – we don't exceed maximum number of prefetched objects
    else if @prefetch > 0 and fetched < @prefetch
      n = @prefetch - fetched

    else
      return this

    # Ensure we don't exceed number of simultaneous requests.
    n = _.min([ n, slots ])

    # Ensure we don't exceed pool capacity.
    n = _.min([ n, room ])

    if LOG_INFO
      @log "Fetching #{n} #{pluralize('object', n)}."

    _.times(n, @load)

    this

  load: ->
    startedAt = _.now()
    timeouted = false

    if @fetchTimeout? and @fetchTimeout isnt 0
      safeguard = =>
        --@fetching
        timeouted = true
        process.nextTick(@fulfill)
        if LOG_INFO
          @log "Fetch timeouted in #{_.now() - startedAt} ms."

      timerID = setTimeout(safeguard, @fetchTimeout)

    ++@fetching

    @source.load (error, objects) =>
      process.nextTick(@fulfill)

      return if timeouted

      clearTimeout(timerID) if timerID?

      --@fetching

      if error?
        if LOG_ERROR
          @log "Fetch failed: \"#{error}\"."
        return

      if LOG_INFO
        @log "Fetched #{objects.length} #{pluralize('object', objects.length)} in #{_.now() - startedAt} ms."

      @push(object, false) for object in objects

      null

  push: (object, fulfill) ->
    id = @id(object)
    for other in @objects
      if id is @id(other)
        if LOG_INFO
          @log "Exists #{id}."
        return this

    @objects.push(object)
    @size = @objects.length

    if LOG_INFO
      @log "Pushed #{id}."

    process.nextTick(@fulfill) if fulfill isnt false
    this

  fulfill: ->
    @fetch()

    for pull in @pulls when ({timeoutID} = pull.options)?
      unless pull.callback?
        clearTimeout(timeoutID)
        pull.options.timeoutID = null

    @pulls = _.filter @pulls, ({callback}) -> callback?

    for pull in @pulls.slice() when pull.count <= @size
      objects  = _.take(@objects, pull.count)
      @objects = _.drop(@objects, pull.count)
      @size    = @objects.length
      @pulls   = _.without(@pulls, pull)
      if ({timeoutID} = pull.options)?
        clearTimeout(timeoutID)
        pull.options.timeoutID = null
      @log "Pulled #{pull.count} #{pluralize('object', pull.count)} in #{_.now() - pull.time} ms." if LOG_INFO
      pull.callback(null, objects)

    @fetch()
    this

  pull: (count, x, y) ->
    options     = if arguments.length > 2 then x else {}
    callback    = if arguments.length > 2 then y else x
    count      ?= 1
    timeout     = options.timeout ?= @fulfillTimeout
    self        = this
    time        = _.now()

    if LOG_INFO
      @log "Requested #{count} #{pluralize('object', count)}."

    @pulls.push(pull = new @Pull(count, callback, time, options))

    if timeout? and timeout isnt 0
      options.timeoutID = setTimeout ->
        options.timeoutID = null
        if pull.callback? and pull in self.pulls
          self.pulls = _.without(self.pulls, pull)
          error      = "Pull timeouted in #{_.now() - time} ms."
          console.log self.prefix + error if LOG_INFO
          pull.callback(error)
      , timeout

    process.nextTick(@fulfill)
    pull

  module.exports = this
