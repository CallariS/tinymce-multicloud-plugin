import type { CloudProvider } from "../types";
import { bayerncloudProvider } from "./bayerncloud";
import { dropboxProvider } from "./dropbox";
import { googleDriveProvider } from "./googleDrive";
import { oneDriveProvider } from "./oneDrive";

/**
 * Returns a fresh array containing one instance of each built-in cloud provider.
 *
 * A factory function is used (rather than a module-level constant) so that provider
 * module state (e.g. cached SDK instances) is not shared across test runs or multiple
 * plugin registrations.
 *
 * @returns Array of all four built-in {@link CloudProvider} implementations:
 *   Google Drive, OneDrive, Dropbox, and BayernCloud (Nextcloud/WebDAV).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const builtInProviders = (): CloudProvider[] => [
    googleDriveProvider(),
    oneDriveProvider(),
    dropboxProvider(),
    bayerncloudProvider(),
];
