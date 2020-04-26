import request from 'request';
import uuid from 'uuid';
import querystring from 'querystring';
import { default as utils } from './utils';
import config from './config';
import url from 'url';
import { debug as createDebugger } from 'debug';

const debug = createDebugger('universal-analytics');

const enum MetricType {
  PAGEVIEW = 'pageview',
}
type ArbitraryParams = { [key: string]: string };
type ArbitraryParamsBatch = ArbitraryParams[];
type Callback = (error?: Error, count?: number) => void;
type TrackingID = string;
type ClientID = string;
type UserID = string;
type VisitorContext = { [key: string]: string };
type PersistentParams = { [key: string]: string };
type VisitorOptions = {
  tid?: TrackingID;
  cid?: ClientID;
  uid?: UserID;
  hostname?: string;
  path?: string;
  https?: boolean;
  enableBatching?: boolean;
  batchSize?: number;
  debug?: boolean;
  strictCidFormat?: boolean;
  requestOptions?: { [key: string]: any };
  headers?: { [key: string]: string };
};
export type PageviewParams = ArbitraryParams & {
  /**
   * Document Path
   * The path portion of the page URL. Should begin with '/'.
   * Max length: 2048 Bytes
   */
  dp?: string;
  /**
   * Document Host Name
   * Specifies the hostname from which content was hosted.
   * Max length: 100 Bytes
   */
  dh?: string;
  /**
   * Document Title
   * The title of the page / document.
   * Max length: 1500 Bytes
   */
  dt?: string;
  /**
   * Document location URL
   * Use this parameter to send the full URL (document location) of the page on which content resides.
   * Max length: 2048 Bytes
   */
  dl?: string;
};

export function init(options: VisitorOptions) {
  return new Visitor(options);
}

export class Visitor {
  private readonly tid: TrackingID | undefined;
  private readonly cid: ClientID | undefined;
  private readonly uid: UserID | undefined;

  constructor(
    private readonly options: VisitorOptions = {},
    private context: VisitorContext = {},
    private persistentParams: PersistentParams = {},
    private readonly queue: ArbitraryParams[] = [],
  ) {
    if (!options) {
      return;
    }
    if (options.hostname != null) {
      config.hostname = options.hostname;
    }

    if (options.path != null) {
      config.path = options.path;
    }

    if (options.enableBatching != null) {
      config.batching = options.enableBatching;
    }

    if (options.batchSize != null) {
      config.batchSize = options.batchSize;
    }

    const protocol = options.https === false ? 'http' : 'https';
    const parsedHostname = url.parse(config.hostname);
    config.hostname = `${protocol}://${parsedHostname.host}`;
    this.tid = options.tid;
    this.cid = options.cid || uuid.v4();
    this.uid = options.uid;
  }

  public reset(): void {
    this.context = {};
  }

  public set(key: string | number, value: any): void {
    this.persistentParams[key] = value;
  }

  public async pageview(o: {
    path: string;
    hostname?: string;
    title?: string;
    params?: ArbitraryParams;
    callback?: Callback;
  }): Promise<Visitor> {
    const pageviewParams = Object.assign({}, this.persistentParams, o.params);
    pageviewParams.dp = o.path || this.context.dp;
    pageviewParams.dh = o.hostname || this.context.dh;
    pageviewParams.dt = o.title || this.context.dt;
    const tidyParameters = this.tidyParameters(pageviewParams);
    return this.withContext(o.params).enqueue(
      MetricType.PAGEVIEW,
      tidyParameters,
      o.callback,
    );
  }

  private getBody(params: ArbitraryParams | ArbitraryParamsBatch): string {
    // @ts-ignore
    return params.map(p => querystring.stringify(p)).join('\n');
  }

  private getNextSendBatch(): ArbitraryParamsBatch {
    const maxBatchSize = Math.min(this.queue.length, config.batchSize);
    return this.queue.splice(0, maxBatchSize);
  }

  private getSendTaskQueue(): (ArbitraryParams | ArbitraryParamsBatch)[] {
    if (!config.batching) {
      return this.queue.splice(0, this.queue.length);
    }

    const q: ArbitraryParamsBatch[] = [];
    const nBuckets = Math.ceil(this.queue.length / config.batchSize);
    for (let i = 0; i < nBuckets; i++) {
      q.push(this.getNextSendBatch());
    }
    return q.filter((bucket: ArbitraryParamsBatch) => bucket.length > 0);
  }

  public readonly send = async (
    fn: Callback = () => undefined,
  ): Promise<void> => {
    const taskQueue = this.getSendTaskQueue();
    debug('Sending %d tracking call(s)', taskQueue.length);
    let count = 0;

    try {
      if (!taskQueue.length) {
        fn.call(this, null, 0);
        return;
      }

      const pathFragment = config.batching ? config.batchPath : config.path;
      const path = `${config.hostname}${pathFragment}`;

      const tasks = taskQueue.map(
        task =>
          new Promise((resolve, reject) => {
            const options = Object.assign({}, this.options.requestOptions, {
              body: this.getBody(task),
              headers: this.options.headers || {},
            });
            request.post(path, options, err => {
              if (err) reject(err);
              count++;
              debug('%d: %o', count, task);
              resolve();
            });
          }),
      );

      await Promise.all(tasks);
      debug('Finished sending tracking calls');
      fn.call(this, null, count);
    } catch (e) {
      fn.call(this, e.message, count);
    }
  };

  private enqueue(
    t: MetricType,
    p: ArbitraryParams = {},
    fn?: Callback,
  ): Visitor {
    const params = this.translateParams(p);
    const defaults = {
      v: config.protocolVersion,
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

  private withContext(context): Visitor {
    const visitor = new Visitor(
      this.options,
      context,
      this.persistentParams,
      this.queue,
    );
    return visitor;
  }

  private translateParams(params: ArbitraryParams): ArbitraryParams {
    var translated = {};
    for (var key in params) {
      if (config.parametersMap.hasOwnProperty(key)) {
        translated[config.parametersMap[key]] = params[key];
      } else {
        translated[key] = params[key];
      }
    }
    return translated;
  }

  private tidyParameters(params: ArbitraryParams): ArbitraryParams {
    for (var param in params) {
      if (params[param] === null || params[param] === undefined) {
        delete params[param];
      }
    }
    return params;
  }

  private checkParameters(params: ArbitraryParams) {
    for (var param in params) {
      if (
        config.acceptedParameters.indexOf(param) !== -1 ||
        config.acceptedParametersRegex.filter(function(r) {
          return r.test(param);
        }).length
      ) {
        continue;
      }
      debug(
        'Warning! Unsupported tracking parameter %s (%s)',
        param,
        params[param],
      );
    }
  }
}

// add to docs
/*
'visitor.debug() is deprecated: set DEBUG=universal-analytics to enable logging',



*/
