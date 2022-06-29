import assert from "assert";

/**
 * Utility class related to numbers
 */
export class NumberUtils {

    /**
     * @return A variation in % between two numbers `start` and `end`. Can be negative.
     */
    static getPercentVariation(start: number, end: number): number {
        if (start === 0) {
            start = 0.00000001;
        }
        if (start <= end) {
            return this.truncateNumber(Math.abs(((end - start) / start) * 100), 3);
        } else {
            return this.truncateNumber(-((start - end) / start) * 100, 3);
        }
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
     * @return Random number (min and max included)
     */
    static randomNumber(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1) + min)
    }
}