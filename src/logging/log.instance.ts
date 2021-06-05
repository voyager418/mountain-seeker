const winston = require('winston');
const CONFIG = require('config').logging;

const defaultFormat = {
    format : winston.format.combine(
        winston.format.timestamp({
            format: 'DD-MM-YYYY HH:mm:ss'

        }),
        winston.format.splat(),
        winston.format.printf((info: { timestamp: never; level: never; message: never; }) =>
            `[${info.timestamp}] ${info.level}: ${info.message}`)
    )
}

/**
 * Creates defaultFormat custom logger instance.
 * @link https://github.com/winstonjs/winston
 */
const log = winston.createLogger({
    level: CONFIG.level,
    format: defaultFormat.format,
    transports: []
});


if (process.env.NODE_ENV === "prod") {
    log.add(new winston.transports.Console());
} else if (process.env.NODE_ENV === "test") {
    log.add(new winston.transports.Console({ silent: true }));
} else {
    log.add(new winston.transports.Console(
        { format: winston.format.combine(
            winston.format.colorize(),
            defaultFormat.format
        ) },
    ));
    log.add(new winston.transports.File({
        filename: 'log.log',
        level: 'debug' }
    ));
}

export default log;