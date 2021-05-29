import { Service } from "typedi";
const CONFIG = require('config');

@Service()
export class ConfigService {
    private readonly config: any;

    constructor() {
        this.config = CONFIG;
    }

    public getConfig(): any {
        return this.config;
    }

    public isSimulation(): boolean {
        return this.config.simulation;
    }

}