import { Moment } from "moment";
export interface IImg {
    date: string;
    imgsArr : Array<any>;
}
export interface IImgsCore {
    lastUpdate : Moment,
    imgs : Array<IImg>,
    scrapeInProgress : boolean
}