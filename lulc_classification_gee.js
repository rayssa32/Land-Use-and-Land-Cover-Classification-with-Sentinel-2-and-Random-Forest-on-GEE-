/**************************************************************
  Land Use and Land Cover Classification (LULC) with Sentinel-2,
  NDVI, NDWI, NDBI and Random Forest in Google Earth Engine.

  This script iterates through a FeatureCollection of 7 cities,
  generates a median composite of Sentinel-2 imagery per city,
  computes spectral indices, extracts samples from ESA WorldCover
  and runs a Random Forest classifier to predict 5 land cover classes.
**************************************************************/

/* ================== PARAMETERS ================== */

// FeatureCollection asset containing the 7 target municipalities
var ASSET_FC = 'projects/sete-cidades/assets/sete_cidades';

// Name of the attribute storing the feature name (ex: city name)
var NAME_FIELD = 'NM_MUN';

// Date range to filter Sentinel-2 imagery
var DATE_START = '2025-07-10';
var DATE_END   = '2025-07-30';

// Sentinel-2 Surface Reflectance collection (harmonized)
var S2 = 'COPERNICUS/S2_SR_HARMONIZED';

// Sentinel-2 band list used as inputs to the model
var BANDS10 = ['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'];

// Color palette for classification results (0–4)
var CLASS_PALETTE = ['#3b83bd','#8c8c8c','#c8a165','#2ca25f','#a1d99b'];

// Enable or disable cloud masking based on SCL band
var APPLY_CLOUD_MASK = true;


/* ================== HELPER FUNCTIONS ================== */

// Simplify input geometry: dissolve and simplify to reduce vertex count
function stableGeom(feat) {
  var g = ee.Feature(feat).geometry();
  g = g.dissolve();
  g = g.simplify(50); // tolerance in meters
  return g;
}

// Cloud masking using Sentinel-2 Scene Classification Layer (SCL)
function maskS2(image) {
  var scl = image.select('SCL');
  var cloud  = scl.eq(8).or(scl.eq(9)).or(scl.eq(10)).or(scl.eq(11));
  var shadow = scl.eq(3);
  var sat    = scl.eq(1);
  var mask = cloud.or(shadow).or(sat).not();
  return image.updateMask(mask);
}

// Add spectral indices to composite: NDVI, NDWI, NDBI
function addIndices(img) {
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndbi = img.normalizedDifference(['B11', 'B8']).rename('NDBI');
  return img.addBands([ndvi, ndwi, ndbi]);
}

// Generate median composite, fallback to non-masked version if needed
function getComposite(geom) {
  var col = ee.ImageCollection(S2)
    .filterDate(DATE_START, DATE_END)
    .filterBounds(geom);

  var masked = APPLY_CLOUD_MASK ? col.map(maskS2) : col;
  var validCount = masked.size();

  var selected = ee.ImageCollection(ee.Algorithms.If(validCount.gt(0), masked, col));

  return addIndices(selected.median().clip(geom));
}

// Sample ESA WorldCover to generate training points
function autoSamples(geom) {
  var wc = ee.Image('ESA/WorldCover/v200/2021').clip(geom);

  var from = [10,20,30,40,50,60,70,80,90,95,100]; // ESA values
  var to   = [ 3, 3, 4, 4, 1, 2, 3, 0, 3,  3,  3]; // Custom class remap

  var labeled = wc.remap(from, to).rename('class_auto');

  return labeled.stratifiedSample({
    numPoints: 500,
    classBand: 'class_auto',
    region: geom,
    scale: 10,
    geometries: true,
    seed: 42
  });
}

// Train a Random Forest classifier on the input data
function trainRF(img, samples, bands, classProp) {
  var training = img.select(bands).sampleRegions({
    collection: samples,
    properties: [classProp],
    scale: 10
  });

  return ee.Classifier.smileRandomForest({
    numberOfTrees: 200,
    seed: 42
  }).train({
    features: training,
    classProperty: classProp,
    inputProperties: bands
  });
}


/* ================== EXECUTION ================== */

// Load the municipal FeatureCollection
var fc = ee.FeatureCollection(ASSET_FC);

// Center the map on one city to avoid performance issues
Map.centerObject(fc.first(), 8);

// Draw city boundaries for reference
Map.addLayer(fc.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'City Boundaries');

// Convert FC to list and loop through each feature (city)
var list = fc.toList(fc.size());
var n = list.size().getInfo();

for (var i = 0; i < n; i++) {
  var f = ee.Feature(list.get(i));
  var name = ee.String(f.get(NAME_FIELD)).getInfo();

  var geom = stableGeom(f);
  var comp = getComposite(geom);

  var inputBands = BANDS10.concat(['NDVI', 'NDWI', 'NDBI']);

  var samples = autoSamples(geom);
  var clf = trainRF(comp, samples, inputBands, 'class_auto');

  var lulc = comp.select(inputBands).classify(clf).rename('LULC').clip(geom);

  Map.addLayer(comp.select(['B4', 'B3', 'B2']), {min: 0, max: 3000}, 'RGB - ' + name);
  Map.addLayer(lulc, {min: 0, max: 4, palette: CLASS_PALETTE}, 'LULC - ' + name);
}

/* ================== END ================== */
