# Land Use and Land Cover (LULC) Classification using Sentinel-2, WorldCover and Random Forest

This repository contains a complete workflow for performing supervised land use and land cover (LULC) classification in **Google Earth Engine (GEE)**.  
The method uses **Sentinel-2 imagery + spectral indices + Random Forest** and is automatically trained using **ESA WorldCover (2021)** data.

The current implementation was developed for **7 municipalities in Brazil**, but the script is fully adaptable to any region with minimal changes.

---

## Purpose of the Project

The goal of this workflow is to automatically classify landscape elements such as:

| Class ID | Class Name      | Color |
|----------|-----------------|-------|
| 0        | Water           | Blue  |
| 1        | Urban / Built-up| Gray  |
| 2        | Bare Soil       | Brown |
| 3        | Vegetation      | Green |
| 4        | Agriculture / Pasture | Light Green |

Instead of manually digitizing training samples, the script **extracts labeled pixels from ESA WorldCover** and remaps them into the 5 desired classes.  
This makes the method:

✅ scalable  
✅ reproducible  
✅ parameter-controlled  
✅ fast to apply in different regions

---

## Data Sources

| Data Source | Use | Notes |
|-------------|-----|-------|
| **Sentinel-2 SR Harmonized** (`COPERNICUS/S2_SR_HARMONIZED`) | Imagery for classification | Uses median composite |
| **ESA WorldCover 2021 (10 m)** | Training labels | Reclassified to 5 custom classes |
| **FeatureCollection (7 cities asset)** | Spatial mask | Each city processed separately |

---

## Methodology — Step by Step

### 1. Load the 7-city FeatureCollection  
Each city is handled as a separate classification unit (no mosaicking of polygons).

### 2. Sentinel-2 composite  
- Images are filtered by date range
- Optional cloud masking via band `SCL`
- Median reducer ensures consistent mosaic
- 10 original S2 bands are preserved

### 3. Spectral indices (feature engineering)
| Index | Formula | Purpose |
|--------|---------|----------|
| NDVI | (B8 – B4) / (B8 + B4) | Vegetation vigor |
| NDWI | (B3 – B8) / (B3 + B8) | Water detection |
| NDBI | (B11 – B8) / (B11 + B8) | Built-up identification |

These indices significantly improve separability between classes in RF.

### 4. Automatic training sample extraction  
ESA WorldCover → stratified sampling → 500 points / region.

### 5. Model training  
- Random Forest, 200 trees
- Per-city model (not global)
- Training features = 10 S2 bands + 3 indices

### 6. Classification output  
- Raster clipped per city
- Displayed as LULC layer + RGB reference

---

## How to Adapt for Other Regions

| Need | What to change |
|------|----------------|
| Different region | Replace `ASSET_FC` asset |
| Different number of classes | Modify remap table in `autoSamples()` |
| Different satellite | Swap Sentinel-2 collection and bands |
| Need export output | Add `Export.image.toDrive()` or `toAsset()` |
| Use manual training | Replace `autoSamples()` with user polygons |

---

## Why Random Forest?

Random Forest was chosen because it is:

- robust to noisy data  
- requires no feature scaling  
- performs well with multispectral data  
- handles nonlinear class separation  
- fast to train even with many bands  

---

## Why ESA WorldCover?

Unlike land-use datasets such as MODIS LC or MCD12Q1, WorldCover:

✅ Has **10 m resolution** (same as Sentinel-2)  
✅ Is **globally available and recent (2021)**  
✅ Contains land classes already suitable for RF training  
✅ Greatly reduces dependency on manual labeling  

---

## Known Limitations

| Limitation | Notes |
|------------|-------|
| Cloudy regions may reduce composite quality | Option to disable cloud mask |
| WorldCover has some regional errors | Manual training can replace it |
| Random Forest does not provide temporal classification | Optional extension: time-series |

---

## Common Errors & Fixes

| Problem | Cause | Solution |
|---------|-------|----------|
| `Geometry has too many edges` | Polygon too detailed | Script auto-simplifies (`dissolve + simplify()`) |
| `No samples found` | Region not in WorldCover | Increase sample size or draw samples manually |
| Blank map output | No valid S2 pixels in date range | Expand `DATE_START` / `DATE_END` |

---

## ▶️ Running the Script

1. Open **GEE Code Editor**
2. Upload or link the FeatureCollection with the 7 cities
3. Update the variable `ASSET_FC` if needed
4. Paste the script from `/src/lulc_classification_gee.js`
5. Click **Run**
6. Toggle layers in the map panel

---

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 License (CC BY-NC-ND 4.0)**.

✔ You may share the code  
❌ You may not use it commercially  
❌ You may not modify or republish it without permission  

Full text in: [`LICENSE`](./LICENSE)

✅ License will be updated after scientific publication.

---



