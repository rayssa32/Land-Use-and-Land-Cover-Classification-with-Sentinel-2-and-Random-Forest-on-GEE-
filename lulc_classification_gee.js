/**************************************************************
  Land Use and Land Cover Classification (LULC) with Sentinel-2,
  NDVI, NDWI, NDBI and Random Forest in Google Earth Engine.

  This script iterates through a FeatureCollection of 7 cities,
  generates a median composite of Sentinel-2 imagery per city,
  computes spectral indices, extracts samples from ESA WorldCover
  and runs a Random Forest classifier to predict 5 land cover classes.
**************************************************************/

/* ================== PARAMETERS ================== */

var ASSET_FC = 'projects/sete-cidades/assets/sete_cidades';
var NAME_FIELD = 'NM_MUN';

var DATE_START = '2025-07-10';
var DATE_END   = '2025-07-30';

var S2 = 'COPERNICUS/S2_SR_HARMONIZED';

var BANDS10 = ['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'];

var APPLY_CLOUD_MASK = true;

/*
  PALETA NOVA (com NoData no índice 0):
  0 = NoData (preto)
  1..5 = paleta antiga (0..4) deslocada 1 casa
*/
var CLASS_PALETTE_OLD = ['#3b83bd','#8c8c8c','#c8a165','#2ca25f','#a1d99b'];
var CLASS_PALETTE_NEW = ['#000000'].concat(CLASS_PALETTE_OLD);


/* ================== HELPER FUNCTIONS ================== */

function stableGeomFromFC(featureCollection) {
  // dissolve + simplify (evita geometria pesada e bugs)
  var g = ee.FeatureCollection(featureCollection).geometry().dissolve();
  g = g.simplify(50); // metros
  return g;
}

function maskS2(image) {
  var scl = image.select('SCL');
  var cloud  = scl.eq(8).or(scl.eq(9)).or(scl.eq(10)).or(scl.eq(11));
  var shadow = scl.eq(3);
  var sat    = scl.eq(1);
  var mask = cloud.or(shadow).or(sat).not();
  return image.updateMask(mask);
}

function addIndices(img) {
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndbi = img.normalizedDifference(['B11', 'B8']).rename('NDBI');
  return img.addBands([ndvi, ndwi, ndbi]);
}

function getComposite(geom) {
  var col = ee.ImageCollection(S2)
    .filterDate(DATE_START, DATE_END)
    .filterBounds(geom);

  var masked = APPLY_CLOUD_MASK ? col.map(maskS2) : col;
  var validCount = masked.size();

  var selected = ee.ImageCollection(ee.Algorithms.If(validCount.gt(0), masked, col));
  return addIndices(selected.median().clip(geom));
}

function autoSamples(geom) {
  var wc = ee.Image('ESA/WorldCover/v200/2021').clip(geom);

  // ESA values -> classes (antigas) 0..4
  var from = [10,20,30,40,50,60,70,80,90,95,100];
  var to   = [ 3, 3, 4, 4, 1, 2, 3, 0, 3,  3,  3];

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

// 1) Carrega FC (7 cidades)
var fc = ee.FeatureCollection(ASSET_FC);

// 2) Geometria ÚNICA das 7 cidades (isso garante exportar tudo)
var geomAll = stableGeomFromFC(fc);

// Visualização
Map.centerObject(fc.first(), 8);
Map.addLayer(fc.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'City Boundaries');

// 3) Composite e bandas
var comp = getComposite(geomAll);
var inputBands = BANDS10.concat(['NDVI', 'NDWI', 'NDBI']);

// 4) Amostras e treino (para a área total)
var samples = autoSamples(geomAll);
var clf = trainRF(comp, samples, inputBands, 'class_auto');

// 5) Classifica
// lulc_old: 0..4 (água=0, urbano=1, ...)
// lulc_new: 1..5 (água=1, urbano=2, ...)
// e NoData = 0 (preto), via unmask(0)
var lulc_old = comp.select(inputBands).classify(clf).rename('LULC_OLD');
var lulc_new = lulc_old.add(1).rename('LULC').unmask(0).clip(geomAll);

// Camadas no mapa
Map.addLayer(comp.select(['B4', 'B3', 'B2']), {min: 0, max: 3000}, 'RGB (All cities)');
Map.addLayer(
  lulc_new,
  {min: 0, max: 5, palette: CLASS_PALETTE_NEW},
  'LULC (0=NoData, 1..5=classes)'
);

// 6) EXPORTA PARA O DRIVE (TODAS as 7 cidades em um arquivo)
Export.image.toDrive({
  image: lulc_new.toByte(),               // classes inteiras (0..5)
  description: 'LULC_7Cidades_10m_20250710_20250730',
  folder: 'GEE_Exports',                  // pode mudar ou remover
  fileNamePrefix: 'LULC_7Cidades_10m_20250710_20250730',
  region: geomAll,
  scale: 10,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: {cloudOptimized: true}
});

/* ================== END ================== */

