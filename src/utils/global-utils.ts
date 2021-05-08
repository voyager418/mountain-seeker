
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
}