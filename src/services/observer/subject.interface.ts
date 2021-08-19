import { Observer } from "./observer.interface";


export interface Subject {

    /** Adds a new observer to the array */
    registerObserver(observer: Observer): void;

    /** Removes the registered observer from the array */
    removeObserver(observer: Observer): void;

    /** Notifies the registered observers by calling {@link Observer.update} method */
    notifyObservers(observers: Array<Observer>): void;
}