
var async = require("async");
var _ = require("underscore");
var qs = require("querystring");
var request = require("request");
var uuid = require("node-uuid");

var config = require("./config");

module.exports = init;


function init (tid, cid, options) {
	return new Visitor(tid, cid, options);
}


var Visitor = module.exports.Visitor = function (tid, cid, options, context) {

	if (typeof tid === 'object') {
		options = tid;
		tid = cid = null;
	} else if (typeof cid === 'object') {
		options = cid;
		cid = null;
	}

	this._queue = [];

	this.options = options || {};

	this._context = context || null;

	this.tid = tid || this.options.tid;
	this.cid = cid || this.options.cid || uuid.v4();
}

Visitor.prototype = {

	debug: function (debug) {
		this.options.debug = arguments.length === 0 ? true : debug;
		this._log("Logging enabled")
		return this;
	},


	reset: function () {
		this._context = null;
		return this;
	},


	pageview: function (path, params, fn) {
		if (typeof params === 'function') {
			fn = params;
			params = {};
		}
		if (typeof path === 'object') {
			params = path;
			path = null;
		}

		params = _.extend({}, this._context || {}, params)
		params.dp = path || params.dp;

		return this._withContext(params)._enqueue("pageview", params, fn);
	},


	event: function (category, action, label, value, params, fn) {

		if (typeof category === 'object') {
			params = category;
			if (typeof action === 'function') {
				fn = action
			}
			category = action = label = value = null;
		} else if (typeof label === 'function') {
			fn = label;
			label = value = null;
		} else if (typeof value === 'function') {
			fn = value;
			value = null;
		} else if (typeof params === 'function') {
			fn = params;
			params = null;
		}

		params = params || {};

		params.ec = category || params.ec || (this._context || {}).ec;
		params.ea = action || params.ea || (this._context || {}).ea;
		params.el = label || params.el || (this._context || {}).el;
		params.ev = value || params.ev || (this._context || {}).ev;
		params.p = params.p || (this._context || {}).dp;

		this._tidyParameters(params);

		return this._withContext(params)._enqueue("event", params, fn);
	},


	send: function (fn) {
		var self = this;
		var count = 1;
		var fn = fn || function () {};

		self._log("Sending " + self._queue.length + " tracking call(s)");

		var test = function () {
			return self._queue.length > 0;
		}

		var iterator = function (fn) {
			var params = self._queue.shift()
			var path = config.hostname + config.path + "?" + qs.stringify(params);
			self._log(count++ + ": " + JSON.stringify(params));
			request.post(path, fn);
		}

		async.whilst(test, iterator, function (err) {
			self._log("Finished sending tracking calls")
			fn.call(self, err);
		});
	},


	_enqueue: function (type, params, fn) {

		if (typeof params === 'function') {
			fn = params;
			params = {};
		}

		params = params || {};

		_.extend(params, {
			v: config.protocolVersion,
			tid: this.tid,
			cid: this.cid,
			t: type
		});

		this._queue.push(params);

		if (this.options.debug) {
			this._checkParameters(params);
		}

		this._log("Enqueued " + type + " (" + JSON.stringify(params) + ")");

		if (fn) {
			this.send(fn);
		}

		return this;
	},


	_checkParameters: function (params) {
		for (var param in params) {
			if (config.acceptedParameters.indexOf(param) !== -1 ||
					config.customMetricRegex.test(param) ||
					config.customDimensionRegex.test(param)) {
				continue;
			}
			this._log("Warning! Unsupported tracking parameter " + param + " (" + params[param] + ")");
		}
	},


	_tidyParameters: function (params) {
		for (var param in params) {
			if (params[param] === null || params[param] === undefined) {
				delete params[param];
			}
		}
		return params;
	},


	_log: function (message) {
		this.options.debug && console.log("UA " + message);
	},


	_withContext: function (context) {
		var visitor = new Visitor(this.tid, this.cid, this.options, context);
		visitor._queue = this._queue;
		return visitor;
	}


}















