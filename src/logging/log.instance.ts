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
 * @see https://github.com/winstonjs/winston
 */
const log = winston.createLogger({
    level: CONFIG.level,
    format: defaultFormat.format,
    transports: [
        new winston.transports.Console(
            { format: winston.format.combine(
                winston.format.colorize(),
                defaultFormat.format
            ) },
        ),
        // Write all logs with level `error` and to `error.log`
        new winston.transports.File({ filename: 'log.log', level: 'debug' })
    ],
});

export default log;