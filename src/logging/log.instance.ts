const winston = require('winston');
const CONFIG = require('config').logging;

/**
 * Creates a custom logger instance.
 * @see https://github.com/winstonjs/winston
 */
const log = winston.createLogger({
    level: CONFIG.level,
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'DD-MM-YYYY HH:mm:ss'
        }),
        winston.format.colorize(),
        winston.format.json()
    ),
    transports: [
        // Write all logs with level `error` and to `error.log`
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ],
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== 'production') {
    log.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

export default log;