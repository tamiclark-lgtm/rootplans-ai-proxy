import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// Create table if it doesn't exist
async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS plants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      botanical_name VARCHAR(255),
      zone VARCHAR(10),
      zip_code VARCHAR(10),
      location VARCHAR(255),
      sunlight VARCHAR(50),
      plant_type VARCHAR(50),
      rarity VARCHAR(50),
      planting_depth VARCHAR(100),
      squares_needed VARCHAR(50),
      sow_start INT,
      sow_end INT,
      plant_start INT,
      plant_end INT,
      harvest_start INT,
      harvest_end INT,
      pet_safe VARCHAR(50),
      pollinators TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    await ensureTable();

    const { plants, zone, zip_code, location, sunlight, plant_type, rarity, calendar } = req.body;

    if (!plants || !Array.isArray(plants)) {
      return res.status(400).json({ error: "Missing plants array" });
    }

    const calMap = {};
    if (calendar && Array.isArray(calendar)) {
      calendar.forEach(c => { calMap[c.plant?.toLowerCase()] = c; });
    }

    for (const plant of plants) {
      const name = plant.common || plant.name || "";
      if (!name) continue;
      const cal = calMap[name.toLowerCase()] || {};

      await sql`
        INSERT INTO plants (
          name, botanical_name, zone, zip_code, location,
          sunlight, plant_type, rarity,
          planting_depth, squares_needed,
          sow_start, sow_end, plant_start, plant_end,
          harvest_start, harvest_end,
          pet_safe, pollinators, description
        ) VALUES (
          ${name},
          ${plant.botanical || null},
          ${zone || null},
          ${zip_code || null},
          ${location || null},
          ${sunlight || null},
          ${plant_type || null},
          ${rarity || null},
          ${plant.depth || null},
          ${plant.squares || null},
          ${cal.sow_start || null},
          ${cal.sow_end || null},
          ${cal.plant_start || null},
          ${cal.plant_end || null},
          ${cal.harvest_start || null},
          ${cal.harvest_end || null},
          ${plant.pet_safe || null},
          ${plant.pollinators || null},
          ${plant.description || null}
        )
      `;
    }

    res.json({ saved: plants.length });
  } catch (err) {
    console.error("save-plants error:", err);
    res.status(500).json({ error: err.message });
  }
}
