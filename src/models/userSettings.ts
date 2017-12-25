import { IUserModel } from "./userModel";

export interface IUserSettings {
    [user_id: number]: IUserModel
}