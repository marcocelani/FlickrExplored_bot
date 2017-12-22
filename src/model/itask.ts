import { UriOptions } from "request";

export interface ITask {
    task_id: number;
    dateStr: string;
    rpOpt : UriOptions;
}