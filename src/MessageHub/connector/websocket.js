'use strict'

let crossroads = require('crossroads');

let io = require("socket.io");
let AbstractConnector = require("./abstract");
let auth = require('iris-auth-util');


let Router = require('tiny-router');

//@FIXIT : move to MessageHub
let queue = require('global-queue');
const DEFAULT_WS_TIMEOUT = 5000;

class WebsocketConnector extends AbstractConnector {
	constructor() {
		super();
	}
	create(app, options) {

		this.router = crossroads.create();
		this.router.ignoreState = true;

		this.router.addRoute('/auth', (socket, data) => {
			auth.check(data)
				.then((result) => {
					if (!result.value) return Promise.resolve(result);

					socket.token = result.value.token;
					socket.user_id = result.value.user_id;
					socket.user_type = result.value.user_type;

					socket.router = new Router();
					socket.router.setDefaultCallback((event, data) => socket.emit(event, {
						data
					}));

					return result;
				})
				.catch((err) => {
					console.log("WS ERR!", err.stack);
					global.logger && logger.error(err, 'Auth internal error');

					return {
						value: false,
						reason: "Internal error."
					};
				})
				.then(result => {
					return result.value ? socket.authorized.resolve(result) : socket.authorized.reject(new Error(result.reason));
				});
		});

		this.router.addRoute('/{module}/{action}', (socket, data, module, action) => {
			let request_id = data.request_id;

			if (!socket.authorized.promise.isFulfilled()) {
				let denied = {
					state: false,
					reason: 'Auth required',
					request_id: request_id
				};

				socket.emit('message', denied);
				return;
			}
			let params = _.defaults({
				_action: action,
				user_id: socket.user_id,
				user_type: socket.user_type
			}, data.data);

			this.messageHandler(module, params)
				.then((result) => {
					result.request_id = request_id;
					socket.emit('message', result);
				})
				.catch((err) => {
					console.log("ERR!", err.stack);
					global.logger && logger.error(
						err, {
							module: module,
							acion: action
						}, 'Unhandled error caught in MessageHub');

					socket.emit('message', {
						request_id,
						state: false,
						reason: 'Internal error: ' + err.message
					});
				});
		});


		this.router.addRoute('/subscribe', (socket, data) => {
			let request_id = data.request_id;
			if (!socket.authorized.promise.isFulfilled()) {
				let denied = {
					state: false,
					reason: 'Auth required',
					request_id: request_id
				};

				socket.emit('message', denied);
				return;
			}

			let event_name = data.data.event;
			if (!event_name) {
				socket.emit('message', {
					state: false,
					reason: 'incorrect event name'
				});
				return;
			}

			socket.router.addRoute(event_name);

			socket.emit('message', {
				state: true,
				value: true,
				request_id: request_id
			});
		});

		this.router.addRoute('/unsubscribe', (socket, data) => {
			let request_id = data.request_id;
			if (!socket.authorized.promise.isFulfilled()) {
				let denied = {
					state: false,
					reason: 'Auth required',
					request_id: request_id
				};

				socket.emit('message', denied);
				return;
			}

			let event_name = data.data.event;
			if (!event_name) {
				socket.emit('message', {
					state: false,
					reason: 'incorrect event name'
				});
				return;
			}

			socket.router.removeRoute(event_name);

			socket.emit('message', {
				state: true,
				value: true,
				request_id: request_id
			});
		});

		this.router.addRoute('/logout', (socket, data) => {
			let params = _.defaults({
				_action: 'leave',
				user_id: socket.user_id,
				user_type: socket.user_type
			}, data.data);
			console.log("LOGOUT", socket.user_id);
			let request_id = data.request_id;

			this.messageHandler('agent', params)
				.then((result) => {
					result.request_id = request_id;
					socket.emit('message', result);
				})
				.catch((err) => {
					global.logger && logger.error(err, 'Logout internal error');
					socket.emit('message', {
						request_id,
						state: false,
						reason: 'Internal error.'
					});
				});
		});

	}
	listen(server) {
		this.io = io(server);

		setInterval(() => {
			this.io.emit('heartbeat', _.now());
		}, 10000);

		queue.on('broadcast', ({
			data,
			addr = {},
			event
		}) => _.forEach(this.io.sockets.connected, (socket) => {
			if (socket.router && _.every(_.map(addr, (pval, pkey) => socket[pkey] == pval)))
				socket.router.parse(event, data)
		}));

		this.io.on('connection', (socket) => {
			console.log('Connected!');

			let resolve, reject;
			let authorized = new Promise((res, rej) => {
				resolve = res;
				reject = rej;
			});

			socket.authorized = {
				promise: authorized,
				resolve: resolve,
				reject: reject
			};

			authorized
				.timeout(DEFAULT_WS_TIMEOUT)
				.then((result) => {
					socket.emit('auth-accepted', result)
				})
				.catch((result) => socket.disconnect(result))

			socket.on('message', (data) => {
				this.router.parse(data.uri, [socket, data]);
			});
			socket.on('disconnect', (data) => socket.router && socket.router.removeAll());
		});
	}

	on_message(handler) {
		if (handler instanceof Function) {
			this.messageHandler = handler;
		}
	}
}

module.exports = WebsocketConnector;