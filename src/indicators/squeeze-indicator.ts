import { Indicator, IndicatorOutput } from "./indicator.interface";
import { singleton } from "tsyringe";
import { TOHLCV } from "../models/market";
import { spawnSync } from "child_process";
import log from "../logging/log.instance";

/**
 * Squeeze momentum indicator
 */
@singleton()
export class SqueezeIndicator implements Indicator {

    compute(candleSticks: Array<TOHLCV>): IndicatorOutput<SqueezeOutput> {
        let colorsArray: Array<string>;

        const pythonProcess = spawnSync("python3", ["src/scripts/squeeze_indicator.py", candleSticks.toString()]);
        if (pythonProcess.stderr.toString()) {
            log.error(pythonProcess.stderr.toString());
        }

        const pythonOutput = pythonProcess.stdout.toString();
        const valuesArrayEndIndex = pythonOutput.indexOf("],");
        const valuesArray = pythonOutput.substr(2, valuesArrayEndIndex - 2).split(", ")
            .map(element => Number(element));

        const fromColorsIndex = valuesArrayEndIndex + 4;
        colorsArray = pythonOutput.substr(fromColorsIndex, pythonOutput.indexOf("]]") - fromColorsIndex).split(", ");
        colorsArray = colorsArray.map((element: string) => element.replace("'", "")
            .replace("'", ""));

        // should buy when 2 maroon bars are followed by 2 lime
        const shouldBuy = colorsArray[colorsArray.length - 5] === "maroon" && colorsArray[colorsArray.length - 4] === "maroon"
            && colorsArray[colorsArray.length - 3] === "lime" && colorsArray[colorsArray.length - 2] === "lime";

        return {
            shouldBuy: shouldBuy,
            result: {
                values: valuesArray,
                colors: colorsArray
            }
        };
    }
}

export interface SqueezeOutput {
    /** histogram values, negative means red or maroon color and positive means green or lime */
    values: Array<number>;
    /** "red", "maroon", "lime" or "green" */
    colors: Array<string>;
}