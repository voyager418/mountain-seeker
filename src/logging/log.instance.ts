const winston = require('winston');
const CONFIG = require('config').logging;
const getNamespace = require('continuation-local-storage').getNamespace;

const defaultFormat = {
    format : winston.format.combine(
        winston.format.timestamp({
            format: 'DD-MM-YYYY HH:mm:ss'
        }),
        winston.format.splat(),
        winston.format.printf(templateFunction)
    )
}

function templateFunction(info: { timestamp: never; level: never; message: never; }): string {
    const writer = getNamespace('logger');
    return `[${info.timestamp}] ${info.level} ${writer && writer.get('id') ? "("+writer.get('id')+")" : ''}: ${info.message}`;
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

if (process.env.NODE_ENV === "prod" || process.env.NODE_ENV === "test") {
    log.add(new winston.transports.Console());
} else {
    log.add(new winston.transports.Console(
        { format: winston.format.combine(
            winston.format.colorize(),
            defaultFormat.format
        ) },
    ));
}

export default log;