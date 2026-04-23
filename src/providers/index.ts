import type { CloudProvider } from "../types";
import { bayerncloudProvider } from "./bayerncloud";
import { dropboxProvider } from "./dropbox";
import { googleDriveProvider } from "./googleDrive";
import { oneDriveProvider } from "./oneDrive";

export const builtInProviders = (): CloudProvider[] => [
    googleDriveProvider(),
    oneDriveProvider(),
    dropboxProvider(),
    bayerncloudProvider(),
];
