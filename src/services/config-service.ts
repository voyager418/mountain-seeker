import { singleton } from "tsyringe";
const CONFIG = require('config');

@singleton()
export class ConfigService {
    private readonly config = CONFIG;

    public getConfig(): any {
        return this.config;
    }

    public isSimulation(): boolean {
        return this.config.simulation;
    }

    public isTestEnvironment(): boolean {
        return this.config.test;
    }

}