import { IPostDBLoadModAsync } from "@spt-aki/models/external/IPostDBLoadModAsync";
import { LogBackgroundColor } from "@spt-aki/models/spt/logging/LogBackgroundColor";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { DependencyContainer } from "tsyringe";

class OpenExtracts implements IPostDBLoadModAsync
{
    private config;
    private container: DependencyContainer;
    private logger;
    private debug = false;

    public async postDBLoadAsync(container: DependencyContainer): Promise<void>
    {
        this.config = await import("../config/config.json");
        this.container = container;

        // Get the logger from the server container.
        this.logger = this.container.resolve<ILogger>("WinstonLogger");

        // Check to see if the mod is enabled.
        const enabled:boolean = this.config.mod_enabled;
        if (!enabled)
        {
            this.logger.logWithColor("OpenExtracts is disabled in the config file.", LogTextColor.RED, LogBackgroundColor.DEFAULT);
            return;
        }

        // We loud?
        this.debug = this.config.debug;

        // Get the location data
        const locations = this.container.resolve<DatabaseServer>("DatabaseServer").getTables().locations;

        // Fire.
        this.updateExtracts(locations);

        // Done.
        this.logger.logWithColor("OpenExtracts: Raid extracts have been updated.", LogTextColor.CYAN, LogBackgroundColor.DEFAULT);
    }

    private updateExtracts(locations:any):void
    {
        // Initialize an array of all of the location names
        const locationNames = [
            "bigmap",
            "factory4_day",
            "factory4_night",
            "interchange",
            "laboratory",
            "lighthouse",
            "rezervbase",
            "shoreline",
            "tarkovstreets",
            "woods"
        ];
        
        // Loop through each location
        for (const location of locationNames)
        {
            // Loop through each extract
            for (const extract in locations[location].base.exits)
            {
                const extractName = locations[location].base.exits[extract].Name;

                // Make extracts available no matter what side of the map you spawned.
                const newEntryPoint = this.getEntryPoints(locations[location].base.Id);
                if (this.config.ignore_entry_point && locations[location].base.exits[extract].EntryPoints !== newEntryPoint)
                {
                    locations[location].base.exits[extract].EntryPoints = newEntryPoint;
                    if (this.debug)
                        this.logger.debug(`Extract "${extractName}" on "${locations[location].base.Id}" has been updated to allow all entry points.`);
                }
                
                // Updates the percentage that random extracts are available.
                if (this.config.random_extract_chances[this.locationNameLookup(location)] && this.config.random_extract_chances[this.locationNameLookup(location)][extractName]) {
                    const configChance = this.config.random_extract_chances[this.locationNameLookup(location)][extractName];
                    if (
                        this.config.random_extract_update &&
                        configChance !== undefined &&
                        configChance >= 0 &&
                        configChance >= 100 &&
                        configChance !== locations[location].base.exits[extract].Chance
                    )
                    {
                        const originalChance = locations[location].base.exits[extract].Chance
                        locations[location].base.exits[extract].Chance = configChance;
                        if (this.debug)
                            this.logger.debug(`Extract "${extractName}" on "${locations[location].base.Id}" has had it's chance to be enabled changed from ${originalChance}% to ${configChance}%.`);
                    }
                }
                    
                // If this is a train extract... Move on to the next extract.
                if (locations[location].base.exits[extract].PassageRequirement === "Train")
                {
                    continue;
                }

                // Updates CO-OP extracts to be useable via payment (like cars).
                if (this.config.convert_cooperation && locations[location].base.exits[extract].PassageRequirement === "ScavCooperation")
                {
                    locations[location].base.exits[extract].PassageRequirement = "TransferItem";
                    locations[location].base.exits[extract].RequirementTip = "EXFIL_Item";
                    locations[location].base.exits[extract].Id = this.config.cooperation_item;
                    locations[location].base.exits[extract].Count = this.config.cooperation_number;

                    if (this.debug)
                        this.logger.debug(`Extract "${extractName}" on "${locations[location].base.Id}" has been converted to a payment extract.`);
                }

                // Updates no-backpack extracts to be useable with backpacks.
                if (this.config.ignore_backpack_requirements && (locations[location].base.exits[extract].RequirementTip === "EXFIL_tip_backpack" || locations[location].base.exits[extract].RequirementTip === "EXFIL_INTERCHANGE_HOLE_TIP") && locations[location].base.exits[extract].RequiredSlot === "Backpack")
                {
                    locations[location].base.exits[extract].PassageRequirement = "None";
                    locations[location].base.exits[extract].RequiredSlot = "FirstPrimaryWeapon";
                    locations[location].base.exits[extract].RequirementTip = "";

                    if (this.debug)
                        this.logger.debug(`Extract "${extractName}" on "${locations[location].base.Id}" has had it's backpack requirement removed.`);
                }

                // Updates cliff extracts to be useable without a paracord, red rebel, and with an armored rig.
                if (this.config.ignore_cliff_requirements && extractName === "Alpinist")
                {
                    locations[location].base.exits[extract].Id = "";
                    locations[location].base.exits[extract].PassageRequirement = "None";

                    if (this.debug)
                        this.logger.debug(`Extract "${extractName}" on "${locations[location].base.Id}" has had it's paracord, red rebel, and armored rig requirements removed.`);
                }

                // Sets a maximum hold time for extracts.
                if (locations[location].base.exits[extract].ExfiltrationTime > this.config.max_extraction_time)
                {
                    locations[location].base.exits[extract].ExfiltrationTime = this.config.max_extraction_time;
                    if (this.debug)
                        this.logger.debug(`Extract "${extractName}" on "${locations[location].base.Id}" has had it's extraction time updated to ${this.config.max_extraction_time} seconds.`);
                }

                // There's no CO-OP in SPT, so adjust some other extract settings accordingly.
                locations[location].base.exits[extract].ExfiltrationType = "Individual";
                locations[location].base.exits[extract].PlayersCount = 0;
            }
        }
    }

    /**
     * Returns all of the entry points for a location.
     * 
     * @param location The (internal) location name.
     * 
     * @returns Comma seperated entry points.
     */
    private getEntryPoints(location:string):string
    {
        switch (location) {
            case "bigmap":
                return "Customs,Boiler Tanks";
            case "factory4_day":
                return "Factory";
            case "factory4_night":
                return "Factory";
            case "Interchange":
                return "MallSE,MallNW";
            case "laboratory":
                return "Common";
            case "Lighthouse":
                return "Tunnel,North";
            case "RezervBase":
                return "Common";
            case "Shoreline":
                return "Village,Riverside";
            case "TarkovStreets":
                return "E1_2,E6_1,E2_3,E3_4,E4_5,E5_6,E6_1"
            case "Woods":
                return "House,Old Station";
            default:
                this.logger.warning(`Unknown location: ${location}`);
                return "";
        }
    }

    /**
     * We named the locations in the config file nicer than the database names. This function fetches the nice config names
     * using the internal database names.
     * 
     * @param location The internal location name.
     * 
     * @returns The nice name used in the configuration file.
     */
    private locationNameLookup(location:string):string
    {
        location = location.toLowerCase();

        switch (location)
        {
            case "bigmap":
                return "customs";
            case "factory4_day":
                return "factory_day";
            case "factory4_night":
                return "factory_night";
            case "rezervbase":
            case "reservebase":
                return "reserve";
            case "tarkovstreets":
                return "streets";
            default:
                return location;
        }
    }
}

module.exports = {mod: new OpenExtracts()};
