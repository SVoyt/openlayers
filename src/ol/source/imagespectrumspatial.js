// FIXME cannot be shared between maps with different projections

goog.provide('ol.source.ImageSpectrumSpatial');

goog.require('ol');
goog.require('ol.Image');
goog.require('ol.asserts');
goog.require('ol.events');
goog.require('ol.events.EventType');
goog.require('ol.extent');
goog.require('ol.obj');
goog.require('ol.source.Image');
goog.require('ol.uri');

/**
 * @classdesc
 * Source for WMS servers providing single, untiled images.
 *
 * @constructor
 * @fires ol.source.Image.Event
 * @extends {ol.source.Image}
 * @param {Object} opt_options Options.
 * @api
 */
ol.source.ImageSpectrumSpatial = function(opt_options) {

  var options = opt_options || {};

  ol.source.Image.call(this, {
    attributions: options.attributions,
    logo: options.logo,
    projection: options.projection,
    resolutions: options.resolutions
  });

  /**
   * @private
   * @type {?string}
   */
  this.crossOrigin_ =
      options.crossOrigin !== undefined ? options.crossOrigin : null;

  /**
   * @private
   * @type {string|undefined}
   */
  this.url_ = options.url;

  /**
   * @private
   * @type {ol.ImageLoadFunctionType}
   */
  this.imageLoadFunction_ = options.imageLoadFunction !== undefined ?
    options.imageLoadFunction : ol.source.Image.defaultImageLoadFunction;

  /**
   * @private
   * @type {!Object}
   */
  this.params_ = options.params || {};

  /**
   * @private
   * @type {boolean}
   */
  this.hidpi_ = options.hidpi !== undefined ? options.hidpi : true;

  /**
   * @private
   * @type {ol.Image}
   */
  this.image_ = null;

  /**
   * @private
   * @type {ol.Size}
   */
  this.imageSize_ = [0, 0];

  /**
   * @private
   * @type {number}
   */
  this.renderedRevision_ = 0;

  /**
   * @private
   * @type {number}
   */
  this.ratio_ = options.ratio !== undefined ? options.ratio : 1.5;

};
ol.inherits(ol.source.ImageSpectrumSpatial, ol.source.Image);

/**
 * Get the user-provided params, i.e. those passed to the constructor through
 * the "params" option, and possibly updated using the updateParams method.
 * @return {Object} Params.
 * @api
 */
ol.source.ImageSpectrumSpatial.prototype.getParams = function() {
  return this.params_;
};


/**
 * @inheritDoc
 */
ol.source.ImageSpectrumSpatial.prototype.getImageInternal = function(extent, resolution, pixelRatio, projection) {

  if (this.url_ === undefined) {
    return null;
  }

  resolution = this.findNearestResolution(resolution);

  if (pixelRatio != 1 && (!this.hidpi_)) {
    pixelRatio = 1;
  }

  var imageResolution = resolution / pixelRatio;

  var center = ol.extent.getCenter(extent);
  var viewWidth = Math.ceil(ol.extent.getWidth(extent) / imageResolution);
  var viewHeight = Math.ceil(ol.extent.getHeight(extent) / imageResolution);
  var viewExtent = ol.extent.getForViewAndSize(center, imageResolution, 0,
      [viewWidth, viewHeight]);
  var requestWidth = Math.ceil(this.ratio_ * ol.extent.getWidth(extent) / imageResolution);
  var requestHeight = Math.ceil(this.ratio_ * ol.extent.getHeight(extent) / imageResolution);
  var requestExtent = ol.extent.getForViewAndSize(center, imageResolution, 0,
      [requestWidth, requestHeight]);

  var image = this.image_;
  if (image &&
      this.renderedRevision_ == this.getRevision() &&
      image.getResolution() == resolution &&
      image.getPixelRatio() == pixelRatio &&
      ol.extent.containsExtent(image.getExtent(), viewExtent)) {
    return image;
  }

  var params = {
    'imageType': 'png',
    r: 90
  };
  ol.obj.assign(params, this.params_);

  this.imageSize_[0] = Math.round(ol.extent.getWidth(requestExtent) / imageResolution);
  this.imageSize_[1] = Math.round(ol.extent.getHeight(requestExtent) / imageResolution);

  var postData = params['postData'];
  if (params['postData']) {
    delete params['postData'];
  }

  var url = this.getRequestUrl_(requestExtent, this.imageSize_, pixelRatio,
      projection, params);


  if (!params['mapName']) {

    this.image_ = new ol.Image(requestExtent, resolution, pixelRatio,
        {
          method: 'POST',
          data: JSON.stringify(postData),
          url: url,
          imageType: params['imageType']
        }, this.crossOrigin_,
        function(image, src) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', src.url, true);
          xhr.setRequestHeader('Content-type', 'application/json');
          xhr.responseType = 'arraybuffer';
          xhr.onload = function(oEvent) {

            var uInt8Array = new Uint8Array(/** @type {ArrayBuffer} */ xhr.response);
            var i = uInt8Array.length;
            var binaryString = new Array(i);
            while (i--) {
              binaryString[i] = String.fromCharCode(uInt8Array[i]);
            }
            var data = binaryString.join('');

            var base64 = 'data:image/' + src.imageType + ';base64,' + window.btoa(data);
            image.getImage().src = base64;
          };

          xhr.send(src.data);
        });
  } else {
    this.image_ = new ol.Image(requestExtent, resolution, pixelRatio,
        url, this.crossOrigin_, this.imageLoadFunction_);
  }

  this.renderedRevision_ = this.getRevision();

  ol.events.listen(this.image_, ol.events.EventType.CHANGE,
      this.handleImageChange, this);

  return this.image_;
};


/**
 * Return the image load function of the source.
 * @return {ol.ImageLoadFunctionType} The image load function.
 * @api
 */
ol.source.ImageSpectrumSpatial.prototype.getImageLoadFunction = function() {
  return this.imageLoadFunction_;
};


/**
 * @param {ol.Extent} extent Extent.
 * @param {ol.Size} size Size.
 * @param {number} pixelRatio Pixel ratio.
 * @param {ol.proj.Projection} projection Projection.
 * @param {Object} params Params.
 * @return {string} Request URL.
 * @private
 */
ol.source.ImageSpectrumSpatial.prototype.getRequestUrl_ = function(extent, size, pixelRatio, projection, params) {

  ol.asserts.assert(this.url_ !== undefined, 9); // `url` must be configured or set using `#setUrl()`


  if (pixelRatio != 1) {
    params['r'] = 90 * pixelRatio;
  }

  params['w'] = size[0];
  params['h'] = size[1];

  var axisOrientation = projection.getAxisOrientation();
  var bbox;
  if (axisOrientation.substr(0, 2) == 'ne') {
    bbox = [extent[1], extent[0], extent[3], extent[2]];
  } else {
    bbox = extent;
  }
  params['b'] = bbox.join(',') + ',' + projection.getCode();
  var imageType = params['imageType'];
  delete params['imageType'];
  var mapName = params['mapName'];
  delete params['mapName'];

  if (!mapName) {
    mapName = '';
  } else {
    if (mapName[0] !== '/') {
      mapName = '/' + mapName;
    }
  }

  return ol.uri.appendParams(/** @type {string} */ (this.url_ + '/maps' + mapName + '/image.' + imageType), params).replace(/&/g, ';').replace('?', ';');
};


/**
 * Return the URL used for this Spectrum Spatial Mapping Service
 * @return {string|undefined} URL.
 * @api
 */
ol.source.ImageSpectrumSpatial.prototype.getUrl = function() {
  return this.url_;
};


/**
 * Set the image load function of the source.
 * @param {ol.ImageLoadFunctionType} imageLoadFunction Image load function.
 * @api
 */
ol.source.ImageSpectrumSpatial.prototype.setImageLoadFunction = function(
    imageLoadFunction) {
  this.image_ = null;
  this.imageLoadFunction_ = imageLoadFunction;
  this.changed();
};


/**
 * Set the URL to use for requests.
 * @param {string|undefined} url URL.
 * @api
 */
ol.source.ImageSpectrumSpatial.prototype.setUrl = function(url) {
  if (url != this.url_) {
    this.url_ = url;
    this.image_ = null;
    this.changed();
  }
};


/**
 * Update the user-provided params.
 * @param {Object} params Params.
 * @api
 */
ol.source.ImageSpectrumSpatial.prototype.updateParams = function(params) {
  ol.obj.assign(this.params_, params);
  this.image_ = null;
  this.changed();
};

