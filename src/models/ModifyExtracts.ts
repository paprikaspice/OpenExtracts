import { Exit, ILocationBase } from "@spt-aki/models/eft/common/ILocationBase";
import { ILocations } from "@spt-aki/models/spt/server/ILocations";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { OpenExtracts } from "../OpenExtracts";

/**
 * The `ModifyExtracts` class is responsible for orchestrating adjustments to game extracts according to a predefined
 * configuration. It contains methods to adjust individual and global extract properties based on the current
 * configuration settings.
 */
export class ModifyExtracts {
    // This is a mapping of location names as they are represented in the game to their configuration and human-readable
    // counterparts. This is used to convert the location name from the game to the name used in the configuration file.
    /* eslint-disable @typescript-eslint/naming-convention */
    private readonly locationNameMappings = {
        bigmap: { config: "customs", human: "Customs" },
        factory4_day: { config: "factoryDay", human: "Factory (Day)" },
        factory4_night: { config: "factoryNight", human: "Factory (Night)" },
        interchange: { config: "interchange", human: "Interchange" },
        laboratory: { config: "laboratory", human: "Laboratory" },
        lighthouse: { config: "lighthouse", human: "Lighthouse" },
        rezervbase: { config: "reserve", human: "Reserve" },
        reservebase: { config: "reserve", human: "Reserve" }, // Duplicate entry to handle both potential inputs
        shoreline: { config: "shoreline", human: "Shoreline" },
        tarkovstreets: { config: "streets", human: "Streets of Tarkov" },
        woods: { config: "woods", human: "Woods" },
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    /**
     * Make the adjustments to the extracts once the class is instantiated.
     */
    constructor() {
        this.makeAdjustments();
    }

    /**
     * Orchestrates the adjustment of extracts according to the configuration. It iterates over enabled locations and
     * performs various adjustments on the extracts based on the rules defined in the configuration.
     */
    private makeAdjustments(): void {
        const locations: ILocations = OpenExtracts.container
            .resolve<DatabaseServer>("DatabaseServer")
            .getTables().locations;
        const enabledLocations = ModifyExtracts.getEnabledLocations();

        // Iterate over all of the enabled location's exits.
        for (const locationName of enabledLocations) {
            const location = locations[locationName].base as ILocationBase;
            for (const extract of location.exits) {
                this.commonAdjustments(extract);
                this.enableAllEntryPoints(extract, location);
                this.adjustChanceEnabled(extract, location);
                this.adjustMaximumExtractTime(extract, location);

                // We can finish here if this is a train extract.
                if (extract.PassageRequirement === "Train") {
                    continue;
                }

                this.convertCooperationToPayment(extract, location);
                this.removeBackpackRequirement(extract, location);
                this.removeCliffRequirements(extract, location);
            }
        }

        OpenExtracts.logger.log(
            `OpenExtracts: Extracts have successfully adjusted according to the configuration.`,
            "cyan"
        );
    }

    /**
     * Retrieves a set of enabled location names for extract adjustments.
     */
    private static getEnabledLocations(): Set<string> {
        return new Set<string>([
            "bigmap",
            "factory4_day",
            "factory4_night",
            "interchange",
            "laboratory",
            "lighthouse",
            "rezervbase",
            "shoreline",
            "tarkovstreets",
            "woods",
        ]);
    }

    /**
     * Performs common adjustments that are applicable to all extracts.
     */
    private commonAdjustments(extract: Exit): void {
        // This is SPT; all extracts should be individual and have no minimum player requirement.
        extract.ExfiltrationType = "Individual";
        extract.PlayersCount = 0;
    }

    /**
     * Enables all entry points for a specified extract, making it usable regardless of the player's spawn location.
     */
    private enableAllEntryPoints(extract: Exit, location: ILocationBase): void {
        if (!OpenExtracts.config.extracts.ignoreEntryPoint) {
            // Option has been disabled in the configuration file.
            return;
        }

        // Dynamically get all of the entry points for this location.
        const allEntryPoints = this.getAllEntryPoints(location);

        // Update the database and log it if debug is enabled.
        if (extract.EntryPoints !== allEntryPoints) {
            extract.EntryPoints = allEntryPoints;

            if (OpenExtracts.config.general.debug) {
                OpenExtracts.logger.log(
                    `OpenExtracts: ${extract.Name} on ${this.getLocationName(
                        location.Id,
                        "human"
                    )} has been updated to allow all entry points: ${allEntryPoints}.`,
                    "gray"
                );
            }
        }
    }

    /**
     * Adjusts the probability of the extract being enabled based on the configuration settings.
     */
    private adjustChanceEnabled(extract: Exit, location: ILocationBase): void {
        if (!OpenExtracts.config.extracts.random.enabled) {
            // Option has been disabled in the configuration file.
            return;
        }

        const locationConfig = OpenExtracts.config.extracts.random.chances[this.getLocationName(location.Id, "config")];

        // Return early if we can't find the configuration information for this extract.
        if (locationConfig === undefined || locationConfig[extract.Name] === undefined) {
            return;
        }

        const configChance = locationConfig[extract.Name];
        if (configChance !== extract.Chance) {
            const originalChance = extract.Chance;
            extract.Chance = configChance;

            if (OpenExtracts.config.general.debug) {
                OpenExtracts.logger.log(
                    `OpenExtracts: ${extract.Name} on ${this.getLocationName(
                        location.Id,
                        "human"
                    )} has had its chance to be enabled changed from ${originalChance}% to ${configChance}%.`,
                    "gray"
                );
            }
        }
    }

    /**
     * Modifies the maximum extraction time of an extract based on the predefined configuration settings.
     */
    private adjustMaximumExtractTime(extract: Exit, location: ILocationBase): void {
        const originalExtractTime = extract.ExfiltrationTime;
        const maxTime = OpenExtracts.config.extracts.maxExtractionTime;

        if (originalExtractTime <= maxTime) {
            // The original extraction time is already less than or equal to the maximum extraction time.
            return;
        }

        extract.ExfiltrationTime = maxTime;

        if (OpenExtracts.config.general.debug) {
            OpenExtracts.logger.log(
                `OpenExtracts: ${extract.Name} on ${this.getLocationName(
                    location.Id,
                    "human"
                )} has had its extraction time updated from ${originalExtractTime} seconds to ${maxTime} seconds.`,
                "gray"
            );
        }
    }

    /**
     * Converts a cooperation extract to a payment extract according to the configuration settings.
     */
    private convertCooperationToPayment(extract: Exit, location: ILocationBase): void {
        if (!OpenExtracts.config.extracts.cooperation.convertToPayment) {
            // Option has been disabled in the configuration file.
            return;
        }

        if (!ModifyExtracts.isCooperationExtract(extract)) {
            // This isn't a cooperation extract;
            return;
        }

        extract.PassageRequirement = "TransferItem";
        extract.RequirementTip = "EXFIL_Item";
        extract.Id = OpenExtracts.config.extracts.cooperation.item;
        extract.Count = OpenExtracts.config.extracts.cooperation.number;

        if (OpenExtracts.config.general.debug) {
            OpenExtracts.logger.log(
                `OpenExtracts: ${extract.Name} on ${this.getLocationName(
                    location.Id,
                    "human"
                )} has been converted to a payment extract.`,
                "gray"
            );
        }
    }

    /**
     * Determines whether the specified extract is a cooperation extract.
     */
    private static isCooperationExtract(extract: Exit): boolean {
        return extract.PassageRequirement === "ScavCooperation";
    }

    /**
     * Removes the backpack requirement from an extract based on the configuration settings.
     */
    private removeBackpackRequirement(extract: Exit, location: ILocationBase): void {
        if (!OpenExtracts.config.extracts.ignoreBackpackRequirements) {
            // Option has been disabled in the configuration file.
            return;
        }

        if (!ModifyExtracts.isBackpackExtract(extract)) {
            // This isn't a backpack extract;
            return;
        }

        extract.PassageRequirement = "None";
        extract.RequiredSlot = "FirstPrimaryWeapon";
        extract.RequirementTip = "";

        if (OpenExtracts.config.general.debug) {
            OpenExtracts.logger.log(
                `OpenExtracts: ${extract.Name} on ${this.getLocationName(
                    location.Id,
                    "human"
                )} has had its backpack requirement removed.`,
                "gray"
            );
        }
    }

    /**
     * Determines whether the specified extract has a backpack requirement.
     */
    private static isBackpackExtract(extract: Exit): boolean {
        return (
            ModifyExtracts.getBackpackExtractRequirementTips().has(extract.RequirementTip) &&
            extract.RequiredSlot === "Backpack"
        );
    }

    /**
     * Retrieves a set of backpack extract requirement tips.
     */
    private static getBackpackExtractRequirementTips(): Set<string> {
        return new Set<string>(["EXFIL_tip_backpack", "EXFIL_INTERCHANGE_HOLE_TIP"]);
    }

    /**
     * Removes the cliff requirement from an extract based on the configuration settings.
     */
    private removeCliffRequirements(extract: Exit, location: ILocationBase): void {
        if (!OpenExtracts.config.extracts.ignoreCliffRequirements) {
            // Option has been disabled in the configuration file.
            return;
        }

        if (!ModifyExtracts.isCliffExtract(extract)) {
            // This isn't a cliff extract;
            return;
        }

        extract.Id = "";
        extract.PassageRequirement = "None";

        if (OpenExtracts.config.general.debug) {
            OpenExtracts.logger.log(
                `OpenExtracts: ${extract.Name} on ${this.getLocationName(
                    location.Id,
                    "human"
                )} has had its paracord, red rebel, and armored rig requirements removed.`,
                "gray"
            );
        }
    }

    /**
     * Determines whether the specified extract is a cliff extract.
     */
    private static isCliffExtract(extract: Exit): boolean {
        return extract.Name.toLowerCase().includes("alpinist") && extract.PassageRequirement === "Reference";
    }

    /**
     * Retrieves a comma-separated string representing all entry points for a given location.
     */
    private getAllEntryPoints(location: ILocationBase): string {
        const entryPointsSet = new Set<string>();
        for (const extract in location.exits) {
            const entryPoints = location.exits[extract].EntryPoints.split(",");
            entryPoints.forEach((entryPoint: string) => entryPointsSet.add(entryPoint));
        }
        return Array.from(entryPointsSet).join(",");
    }

    /**
     * Retrieves the formatted location name based on the specified type. The method consults the `locationNameMappings`
     * object to find the matching name according to the given type.
     */
    private getLocationName(gameLocationName: string, nameType: "config" | "human"): string {
        const location = gameLocationName.toLowerCase();
        return this.locationNameMappings[location]?.[nameType] || location;
    }
}
