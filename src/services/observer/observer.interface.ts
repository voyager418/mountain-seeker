
export interface Observer {

    /** This method is called by the {@link Subject.notifyObservers} to notify its observers */
    update(data: any, sessionID: string): void;
}