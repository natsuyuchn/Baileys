import { Document, Model } from 'mongoose';
import { Logger } from 'pino';
import { proto } from '../../WAProto';
import {
    AuthenticationCreds,
    AuthenticationState,
    SignalDataTypeMap,
} from '../Types';
import { initAuthCreds } from './auth-utils';
import { BufferJSON } from './generics';

interface IAuthDocument extends Document {
    id: string;
    data: string;
};

export const useMongoDBAuthState = async(
	model: Model<IAuthDocument>,
    logger?: Logger
): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void>, removeCreds: () => Promise<void> }> => {

    const writeData = async(id: string, data: AuthenticationCreds) => {
        logger?.debug({ id }, 'writing data');
        await model.findOneAndUpdate(
            { id },
            { id, data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) },
            { upsert: true, new: true }
        ).exec();
    };

    const readData = async(id: string): Promise<any | null> => {
        logger?.debug({ id }, 'reading data');
        const record = await model.findOne({ id }).exec();
        return record ? JSON.parse(JSON.stringify(record.data), BufferJSON.reviver) : null;
    };

    const removeData = async(id: string) => {
        logger?.debug({ id }, 'removing data');
        await model.deleteOne({ id }).exec();
    };

    const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async(type, ids: string[]) => {
                    logger?.debug({ ids, type }, 'getting data');
                    const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
                    await Promise.all(
                        ids.map(async(id) => {
                            let value = await readData(`${type}-${id}`);
                            if(type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async(data) => {
                    logger?.debug({ data }, 'setting data');
                    const tasks: Promise<void>[] = [];
                    for(const category in data) {
                        for(const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(key, value) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: async() => {
            logger?.debug({ creds }, 'saving creds');
            await writeData('creds', creds);
        },
        removeCreds: async() => {
            logger?.debug({ creds }, 'removing creds');
            await removeData('creds');
        }
    }
};
