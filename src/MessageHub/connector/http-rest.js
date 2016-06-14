'use strict'

let AbstractConnector = require("./abstract");
let router = require("express")
  .Router();
let bodyParse = require("body-parser");
let auth = require('iris-auth-util');

var allowCrossDomain = function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
}

class HttpRest extends AbstractConnector {
  constructor() {
    super();
  }

  create(app, options) {
    router.use(bodyParse.json());
    router.use(bodyParse.urlencoded({
      extended: true
    }));
    router.use(allowCrossDomain);

    router.route("/login")
      .post(function(req, res, next) {
        let user = req.body.user;
        let pass = req.body.password;
        let origin = req.body.origin || "unknown";
        let expiry = req.body.expiry || false;

        auth.authorize({
            user: user,
            password_hash: pass,
            origin: origin,
            expiry: expiry
          })
          .then((success_result) => {
            res.send(success_result);
            next();
          })
          .catch((err) => {
            res.send({
              value: false,
              reason: "Internal error."
            });
            next();
          });
      });

    router.route("/:module/:action")
      .post((req, res, next) => {
        let token = req.body.token;
        auth.check({
          token: token
        }).then((d) => {
          if (d.state) {
            req.user_id = d.value.user_id;
            req.user_type = d.value.user_type;
            next();
            return true;
          }

          res.send({
            success: false,
            reason: d.reason
          });
        }).catch((d) => {
          res.send({
            success: false,
            reason: 'auth error'
          });
        });

      }, (req, res, next) => {
        let action = req.params.action;
        let module = req.params.module;

        let params = _.defaults({
          _action: action,
          user_id: req.user_id,
          user_type: req.user_type
        }, req.body);

        this.messageHandler(module, params)
          .then((result) => {
            res.send(result);
          })
          .catch((err) => {
            global.logger && logger.error(
              err, {
                module: module,
                acion: action
              }, 'Unhandled error caught in MessageHub');

            res.send({
              state: false,
              reason: 'Internal error: ' + err.message
            });
          });
      });

    router.route("/connection/test")
      .post(function(req, res, next) {
        res.send({
          success: true
        });
        next();
      });

    router.route("/cache/flush")
      .get(function(req, res, next) {
        if (req.query.local)
          global.message_bus && message_bus.emit('inmemory.cache', req.query);
        res.send({
          success: true
        });
        next();
      });
    // router.route("/logout")
    // 	.post(function(req, res, next) {
    // 		console.log("LOGOUT");
    // 		res.send({
    // 			value: true,
    // 			reason: "External error."
    // 		});
    // 		next();
    // 	});

    app.use(router);
  }
  on_message(handler) {
    if (handler instanceof Function) {
      this.messageHandler = handler;
    }
  }
}

module.exports = HttpRest;