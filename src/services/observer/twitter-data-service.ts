import log from "../../logging/log.instance";
import { ConfigService } from "../config-service";
import { singleton } from "tsyringe";
import { Subject } from "./subject.interface";
import { BaseStrategy } from "../../strategies/base-strategy.interface";
import { GlobalUtils } from "../../utils/global-utils";
import { Observer } from "./observer.interface";
import TwitterApi from 'twitter-api-v2';


/**
 * This service continually fetches tweets from Binance's twitter platform.
 *
 * {@link https://twitter.com/binance}
 */
@singleton()
export class TwitterDataService implements Subject {

    private readonly observers: Array<BaseStrategy> = [];
    private twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!);
    private roClient = this.twitterClient.readOnly;
    private lastTweetText = "";

    constructor(private configService: ConfigService) {
        this.getTweets().then();
    }

    async getLastTweet(): Promise<void> {
        let tweet;
        try {
            // get Binance last tweets
            const tweets = await this.roClient.v2.userTimeline("877807935493033984");
            tweet = tweets.data.data[0];
            // this.lastTweetText = (await this.roClient.v2.tweets("1466256809400758274")).data[0];
            // this.lastTweetText = (await this.roClient.v2.tweets("1471670975246659589")).data[0];
            // tweet = (await this.roClient.v2.tweets("1475692661822705666")).data[0];
            this.lastTweetText = tweet.text;

            log.debug(`Last tweet : ${JSON.stringify(this.lastTweetText)} (id ${tweet.id}`);
            // notify strategies
            this.notifyObservers(this.observers);

            // sleep
            await GlobalUtils.sleep(1200); // 20 min
        } catch (e) {
            log.error(`Error occurred while fetching data from Twitter : ${e}`)
        }
    }

    registerObserver(observer: BaseStrategy): void {
        // TODO remove if
        if (this.observers.length === 0) {
            this.observers.push(observer);
        }
    }

    removeObserver(observer: BaseStrategy): void {
        const index = this.observers.indexOf(observer, 0);
        if (index > -1) {
            this.observers.splice(index, 1);
        }
    }

    removeAllObservers(): { removed: number, running: number } {
        const running = this.observers.filter(o => o.getState().marketSymbol !== undefined).length;
        const removed = this.observers.length;
        this.observers.splice(0);
        return {
            removed,
            running
        }
    }

    getObserversStatus(): { total: number, running: number } {
        const running = this.observers.filter(o => o.getState().marketSymbol !== undefined).length;
        const total = this.observers.length;
        return {
            total,
            running
        }
    }

    notifyObservers(observers: Array<Observer>): void {
        observers.forEach(observer => observer.update(this.lastTweetText));
    }

    async getTweets(): Promise<void> {
        while (!this.configService.isTestEnvironment()) { // should be "false" when we are running the tests
            await this.getLastTweet();
        }
    }

    private allObserversAreRunning(): boolean {
        return this.observers.every(o => o.getState().marketSymbol !== undefined);
    }

}

