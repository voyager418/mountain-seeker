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
        winston.format.printf((info: { timestamp: never; level: never; message: never; }) =>
            `${info.timestamp} ${info.level}: ${JSON.stringify(info.message)}`)
    ),
    transports: [
        new winston.transports.Console(),
        // Write all logs with level `error` and to `error.log`
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ],
});


export default log;