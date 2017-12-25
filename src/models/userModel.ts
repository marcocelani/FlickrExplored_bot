import { Document, Schema, Model } from "mongoose";
import * as mongoose from 'mongoose';
import * as mongose_moment from 'mongoose-moment';
import { Moment } from "moment";
import { Config } from "../Config";
mongose_moment(mongoose);
export interface IUserSetup extends Document {
    type: string;
    nextPhotoTime: Moment;
}
export interface IUserModel extends Document {
    user_id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    language_code?: string;
    getCount: number;
    is_stopped?: boolean,
    scheduledTimer?: NodeJS.Timer;
    nextPhotoTime?: Moment;
    userSetup: IUserSetup;
}
export class UserModel {
    public static readonly UserName: string = 'User';
    public static readonly CommandName: string = 'Command';
    private userSchema: Schema;
    private userSetupSchema: Schema;
    private userModel: Model<IUserModel>;
    constructor() {
        /* schema */
        this.userSetupSchema = new Schema({
            type: { 
                type: String,
                required: true
            },
            nextPhotoTime: {
                type: 'Moment',
                required: true
            }
        });
        this.userSchema = new Schema({
            user_id: {
                type: Number,
                required: true
            },
            is_bot: {
                type: Boolean,
                required: true
            },
            first_name: {
                type: String,
                required: true
            },
            last_name: String,
            language_code: String,
            getCount: Number,
            is_stopped: Boolean,
            userSetup: this.userSetupSchema
        }, { collection: Config.MONGO_USR_COLL, timestamps: {} });
        /* model */
        this.userModel = mongoose.model<IUserModel>(UserModel.UserName, this.userSchema);
    }
    get user(): Model<IUserModel> {
        return this.userModel;
    }
}