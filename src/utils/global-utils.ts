/**
 * General purpose utility class
 */
export class GlobalUtils {

    /**
     * Pauses execution for the specified amount of seconds.
     * Must be used with `await` inside an async function
     */
    static sleep(seconds: number): Promise<unknown> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    /**
     * Allows to stringify a Map object when used in {@link JSON.stringify} function.
     * Taken from https://stackoverflow.com/a/56150320
     */
    static replacer(key: any, value: any): any {
        if (value instanceof Map) {
            return {
                dataType: 'Map',
                value: Array.from(value.entries())
            };
        }
        return value;
    }

    /**
     * Converts Binance timestamps into Belgian time
     */
    static getCurrentBelgianDate(): Date {
        const currentDate = new Date();
        let belgianHours = currentDate.toLocaleTimeString("fr-BE", { timeZone: "Europe/Brussels" });
        belgianHours = belgianHours.substr(0, belgianHours.indexOf(':'));
        currentDate.setHours(Number(belgianHours)); // to convert amazon time to belgian
        return currentDate;
    }
}