import { Moment } from "moment";

export interface IStats {
    allUsers: number;
    activeUsers: number;
    botUsers: number;
    totalImagesRequested: number;
    lastUpdate: Moment,
    imgsLength: number;
    scrapeInProgress: boolean;
}