import assert from "assert";

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
     * Cuts the numbers after the dot.
     *
     * Example input : (0.99999, 2) => output 0.99
     */
    static truncateNumber(number: number, digitsAfterDot: number): number {
        if (number.toString().split(".")[1]?.length > digitsAfterDot) {
            return Math.trunc(number * Math.pow(10, digitsAfterDot)) / Math.pow(10, digitsAfterDot);
        }
        return number;
    }

    /**
     * Example input : (10, -50) => output 5
     *
     * @param number A positive number
     * @param percent Percentage (example -10 or 10 for -10%)
     */
    static decreaseNumberByPercent(number: number, percent: number): number {
        assert(number > 0, `${number} must be a positive number`);
        return number - (number * Math.abs(percent)/100);
    }

    /**
     * Example input : (10, 50) => output 15
     *
     * @param number A positive number
     * @param percent Percentage (example 10 for 10%)
     */
    static increaseNumberByPercent(number: number, percent: number): number {
        assert(number > 0, `${number} must be a positive number`);
        assert(percent > 0, `${percent} must be a positive number`);
        return number + (number * Math.abs(percent)/100);
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
        } else {
            return value;
        }
    }

    /**
     * Converts Binance timestamps into Belgian time
     */
    static getCurrentBelgianDate(): Date {
        const currentDate = new Date();
        let belgianHours = currentDate.toLocaleTimeString("fr-BE");
        belgianHours = belgianHours.substr(0, belgianHours.indexOf(':'));
        currentDate.setHours(Number(belgianHours)); // to convert amazon time to belgian
        return currentDate;
    }
}