"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const request_1 = tslib_1.__importDefault(require("request"));
const uuid_1 = tslib_1.__importDefault(require("uuid"));
const querystring_1 = tslib_1.__importDefault(require("querystring"));
const config_1 = tslib_1.__importDefault(require("./config"));
const url_1 = tslib_1.__importDefault(require("url"));
const debug_1 = require("debug");
const debug = debug_1.debug('universal-analytics');
var MetricType;
(function (MetricType) {
    MetricType["PAGEVIEW"] = "pageview";
})(MetricType || (MetricType = {}));
function init(options) {
    return new Visitor(options);
}
exports.init = init;
class Visitor {
    constructor(options = {}, context = {}, persistentParams = {}, queue = []) {
        this.options = options;
        this.context = context;
        this.persistentParams = persistentParams;
        this.queue = queue;
        this.send = async (fn = () => undefined) => {
            const taskQueue = this.getSendTaskQueue();
            debug('Sending %d tracking call(s)', taskQueue.length);
            let count = 0;
            try {
                if (!taskQueue.length) {
                    fn.call(this, null, 0);
                    return;
                }
                const pathFragment = config_1.default.batching ? config_1.default.batchPath : config_1.default.path;
                const path = `${config_1.default.hostname}${pathFragment}`;
                const tasks = taskQueue.map(task => new Promise((resolve, reject) => {
                    const options = Object.assign({}, this.options.requestOptions, {
                        body: this.getBody(task),
                        headers: this.options.headers || {},
                    });
                    request_1.default.post(path, options, err => {
                        if (err)
                            reject(err);
                        count++;
                        debug('%d: %o', count, task);
                        resolve();
                    });
                }));
                await Promise.all(tasks);
                debug('Finished sending tracking calls');
                fn.call(this, null, count);
            }
            catch (e) {
                fn.call(this, e.message, count);
            }
        };
        if (!options) {
            return;
        }
        if (options.hostname != null) {
            config_1.default.hostname = options.hostname;
        }
        if (options.path != null) {
            config_1.default.path = options.path;
        }
        if (options.enableBatching != null) {
            config_1.default.batching = options.enableBatching;
        }
        if (options.batchSize != null) {
            config_1.default.batchSize = options.batchSize;
        }
        const protocol = options.https === false ? 'http' : 'https';
        const parsedHostname = url_1.default.parse(config_1.default.hostname);
        config_1.default.hostname = `${protocol}://${parsedHostname.host}`;
        this.tid = options.tid;
        this.cid = options.cid || uuid_1.default.v4();
        this.uid = options.uid;
    }
    reset() {
        this.context = {};
    }
    set(key, value) {
        this.persistentParams[key] = value;
    }
    async pageview(o) {
        const pageviewParams = Object.assign({}, this.persistentParams, o.params);
        pageviewParams.dp = o.path || this.context.dp;
        pageviewParams.dh = o.hostname || this.context.dh;
        pageviewParams.dt = o.title || this.context.dt;
        const tidyParameters = this.tidyParameters(pageviewParams);
        return this.withContext(o.params).enqueue("pageview", tidyParameters, o.callback);
    }
    getBody(params) {
        return params.map(p => querystring_1.default.stringify(p)).join('\n');
    }
    getNextSendBatch() {
        const maxBatchSize = Math.min(this.queue.length, config_1.default.batchSize);
        return this.queue.splice(0, maxBatchSize);
    }
    getSendTaskQueue() {
        if (!config_1.default.batching) {
            return this.queue.splice(0, this.queue.length);
        }
        const q = [];
        const nBuckets = Math.ceil(this.queue.length / config_1.default.batchSize);
        for (let i = 0; i < nBuckets; i++) {
            q.push(this.getNextSendBatch());
        }
        return q.filter((bucket) => bucket.length > 0);
    }
    enqueue(t, p = {}, fn) {
        const params = this.translateParams(p);
        const defaults = {
            v: config_1.default.protocolVersion,
            tid: this.tid,
            cid: this.cid,
            uid: this.uid,
            t,
        };
        Object.assign(params, defaults);
        this.queue.push(params);
        if (debug.enabled) {
            this.checkParameters(params);
        }
        debug('Enqueued %s (%o)', t, params);
        if (fn) {
            this.send(fn);
        }
        return this;
    }
    withContext(context) {
        const visitor = new Visitor(this.options, context, this.persistentParams, this.queue);
        return visitor;
    }
    translateParams(params) {
        var translated = {};
        for (var key in params) {
            if (config_1.default.parametersMap.hasOwnProperty(key)) {
                translated[config_1.default.parametersMap[key]] = params[key];
            }
            else {
                translated[key] = params[key];
            }
        }
        return translated;
    }
    tidyParameters(params) {
        for (var param in params) {
            if (params[param] === null || params[param] === undefined) {
                delete params[param];
            }
        }
        return params;
    }
    checkParameters(params) {
        for (var param in params) {
            if (config_1.default.acceptedParameters.indexOf(param) !== -1 ||
                config_1.default.acceptedParametersRegex.filter(function (r) {
                    return r.test(param);
                }).length) {
                continue;
            }
            debug('Warning! Unsupported tracking parameter %s (%s)', param, params[param]);
        }
    }
}
exports.Visitor = Visitor;
//# sourceMappingURL=index.js.map