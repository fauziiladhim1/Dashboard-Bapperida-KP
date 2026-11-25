// @terraformer/wkt tidak membawa deklarasi TypeScript; hanya dua fungsi yang dipakai.
declare module '@terraformer/wkt' {
  export function wktToGeoJSON(wkt: string): GeoJSON.Geometry;
  export function geojsonToWKT(geometry: GeoJSON.Geometry): string;
}
