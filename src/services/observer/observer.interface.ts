import { Market } from "../../models/market";


export interface Observer {

    /** This method is called by the {@link Subject.notifyObservers} to notify its observers */
    update(markets: Array<Market>): void;
}