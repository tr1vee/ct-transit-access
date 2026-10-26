#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const sources = [
    { prefix: 'bus', folder: 'transit/raw-data/bus' },
    { prefix: 'hl', folder: 'transit/raw-data/hl' },
    { prefix: 'sle', folder: 'transit/raw-data/sle' }
];

const ctBoundaries = {
    minLat: 40.9,
    maxLat: 42.1,
    minLon: -73.8,
    maxLon: -71.7
}

async function mergegtfs() {
    let allstops = [];

    for (const source of sources) {
        const stopsFilePath = path.join(source.folder, 'stops.txt');
        if (fs.existsSync(stopsFilePath)) {
            const stopsContent = fs.readFileSync(stopsFilePath, 'utf-8');
            const records = parse(stopsContent, { columns: true, skip_empty_lines: true });

            
            const prefixedStops = records.map(stop => ({ 
                stop_id: `${source.prefix}_${stop.stop_id}`,
                stop_name: stop.stop_name,
                stop_lat: parseFloat(stop.stop_lat),
                stop_lon: parseFloat(stop.stop_lon),
                wheelchair_boarding: stop.wheelchair_boarding || "0",
                agency_prefix: source.prefix
            }));
            
            const filteredStops = prefixedStops.filter (stop => 
                stop.stop_lat >= ctBoundaries.minLat &&
                stop.stop_lat <= ctBoundaries.maxLat &&
                stop.stop_lon >= ctBoundaries.minLon &&
                stop.stop_lon <= ctBoundaries.maxLon
            );

            allstops.push(...filteredStops);
            console.log(`Merged ${filteredStops.length} stops from ${source.prefix}`);
        } else {
            console.warn(`stops.txt not found for ${source.prefix} at ${stopsFilePath}`);
        }
    }

    
    const outputDir = path.join(process.cwd(), '../src/data');
    fs.mkdirSync(outputDir, { recursive: true });

    
    const outputFilePath = path.join(outputDir, 'stops.json');
    fs.writeFileSync(outputFilePath, JSON.stringify(allstops, null, 2));
    console.log(`Successfully wrote ${allstops.length} total stops to ${outputFilePath}`);

    return allstops;
}

mergegtfs();