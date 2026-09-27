/**************************************************************
  Land Use and Land Cover Classification (LULC) with Sentinel-2,
  NDVI, NDWI, NDBI and Random Forest in Google Earth Engine.

  This script iterates through a FeatureCollection of 7 cities,
  generates a median composite of Sentinel-2 imagery per city,
  computes spectral indices, extracts samples from ESA WorldCover
  and runs a Random Forest classifier to predict 5 land cover classes.
  
**************************************************************/
/* ================== PARAMETERS ================== */

var ASSET_FC   = 'projects/sete-cidades/assets/sete_cidades';
var NAME_FIELD = 'NM_MUN';

var DATE_START = '2025-07-10';
var DATE_END   = '2025-07-30';

var S2 = 'COPERNICUS/S2_SR_HARMONIZED';

var BANDS10 = ['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'];

var APPLY_CLOUD_MASK   = true;
var NUM_SAMPLES_PER_CLASS = 2000;   // igual ao script original (era 500 na versão nova)
var SIMPLIFY_METERS    = 0;         // 0 = sem simplificação, igual ao script original
var CRS                = 'EPSG:31983'; // UTM 23S SIRGAS 2000, igual ao script original

/*
  PALETA (com NoData no índice 0):
  0 = NoData (preto)
  1 = Água | 2 = Urbano | 3 = Solo | 4 = Vegetação | 5 = Agro/Pasto
*/
var CLASS_PALETTE_OLD = ['#3b83bd','#8c8c8c','#c8a165','#2ca25f','#a1d99b'];
var CLASS_PALETTE_NEW = ['#000000'].concat(CLASS_PALETTE_OLD);


/* ================== HELPER FUNCTIONS ================== */

function stableGeomFromFC(featureCollection) {
  var g = ee.FeatureCollection(featureCollection).geometry().dissolve();
  if (SIMPLIFY_METERS > 0) {
    g = g.simplify(SIMPLIFY_METERS);
  }
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

  // fallback: se a máscara zerar todas as imagens, usa a coleção sem máscara
  var selected = ee.ImageCollection(ee.Algorithms.If(validCount.gt(0), masked, col));
  return addIndices(selected.median().clip(geom));
}

function autoSamples(geom) {
  var wc = ee.Image('ESA/WorldCover/v200/2021').clip(geom);

  // ESA values -> classes (0..4, mesmas do script original)
  var from = [10,20,30,40,50,60,70,80,90,95,100];
  var to   = [ 3, 3, 4, 4, 1, 2, 3, 0, 3,  3,  3];

  var labeled = wc.remap(from, to).rename('class_auto');

  return labeled.stratifiedSample({
    numPoints: NUM_SAMPLES_PER_CLASS,
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

  var rf = ee.Classifier.smileRandomForest({
    numberOfTrees: 200,
    seed: 42
  }).train({
    features: training,
    classProperty: classProp,
    inputProperties: bands
  });

  // Matriz de confusão / acurácia do treino (estava faltando na versão "0=NoData")
  var conf = training.classify(rf).errorMatrix(classProp, 'classification');
  print('Matriz de confusão (treino):', conf);
  print('Acurácia (treino):', conf.accuracy());

  return rf;
}

function buildCityIdBand(fc, geom) {
  // Atribui CITY_ID 1..N na ordem das feições da FeatureCollection
  var munList = fc.toList(fc.size());
  var indexed = ee.FeatureCollection(
    ee.List.sequence(0, fc.size().subtract(1)).map(function (i) {
      var f = ee.Feature(munList.get(i));
      return f.set('CITY_ID', ee.Number(i).add(1));
    })
  );
  return ee.Image().byte().paint(indexed, 'CITY_ID').rename('CITY_ID').clip(geom);
}


/* ================== EXECUTION ================== */

var fc = ee.FeatureCollection(ASSET_FC);
var geomAll = stableGeomFromFC(fc);

Map.centerObject(fc.first(), 8);
Map.addLayer(fc.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'City Boundaries');

var comp = getComposite(geomAll);
var inputBands = BANDS10.concat(['NDVI', 'NDWI', 'NDBI']);

var samples = autoSamples(geomAll);
var clf = trainRF(comp, samples, inputBands, 'class_auto');

// lulc_old: 0..4 (água=0, urbano=1, solo=2, vegetação=3, agro=4)
// lulc_new: 1..5 (água=1 ... agro=5), com NoData explícito = 0
var lulc_old = comp.select(inputBands).classify(clf).rename('LULC_OLD');
var lulc_new = lulc_old.add(1).rename('LULC').unmask(0).clip(geomAll);

var cityId = buildCityIdBand(fc, geomAll);

// Empilha LULC + CITY_ID (mesma ideia do script original)
var outImg = lulc_new.addBands(cityId);

/* ================== VISUALIZATION ================== */

Map.addLayer(comp.select(['B4', 'B3', 'B2']), {min: 0, max: 3000}, 'RGB (All cities)');
Map.addLayer(
  lulc_new,
  {min: 0, max: 5, palette: CLASS_PALETTE_NEW},
  'LULC (0=NoData, 1..5=classes)'
);

/* ================== EXPORT ================== */

Export.image.toDrive({
  image: outImg.toByte(),
  description: 'LULC_7Cidades_10m_20250710_20250730',
  folder: 'GEE_Exports',
  fileNamePrefix: 'LULC_7Cidades_10m_20250710_20250730',
  region: geomAll,
  scale: 10,
  crs: CRS,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: {cloudOptimized: true}
});

/* ================== END ================== */
 
