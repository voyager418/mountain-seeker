
/**
 * General purpose utility class
 */
export class GlobalUtils {
    private constructor() {
        // utility class
    }

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
}