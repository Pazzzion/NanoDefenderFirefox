//The Core library for background rules
"use strict";

//=====Initializer=====
/**
 * Initialization.
 * @function
 */
a.init = () => {
    //Message listener
    chrome.runtime.onMessage.addListener((...args) => {
        if (args.length === 3) {
            //Each message must have "cmd" field for the command
            switch (args[0]["cmd"]) {
                /**
                 * Inject CSS to the caller tab.
                 * @param {string} data - The CSS code to inject.
                 */
                case "inject css":
                    if (args[1].tab && args[1].tab.id !== chrome.tabs.TAB_ID_NONE) {
                        chrome.tabs.insertCSS(args[1].tab.id, {
                            code: args[0]["data"],
                            frameId: args[1].frameId || 0,
                        }, () => {
                            if (chrome.runtime.lastError) {
                                //Ignore, assume the tab is closed
                            }
                        });
                    } //Ignore if not called from a proper tab
                    break;
                /**
                 * Do a cross origin XMLHttpRequest.
                 * @param {Object} details - The details object, see a.request() of content-core
                 ** for more information.
                 * @return {string|null} The response text, or null if the request failed.
                 */
                case "xhr":
                    if (typeof args[0].details === "object") {
                        console.warn(`Sending cross origin request to ${args[0].details.url}`);
                        let req = new XMLHttpRequest();
                        //Event handler
                        req.onreadystatechange = () => {
                            if (req.readyState === 4) {
                                try {
                                    args[2](req.responseText);
                                } catch (err) { }
                            }
                        };
                        //Create request
                        req.open(String(args[0].details.method), String(args[0].details.url));
                        //Set headers
                        if (typeof args[0].details.headers === "object") {
                            for (let key in args[0].details.headers) {
                                req.setRequestHeader(key, String(args[0].details.headers[key]));
                            }
                        }
                        //Send request
                        let payload = null;
                        if (args[0].details.payload) {
                            payload = String(args[0].details.payload);
                        }
                        req.send(payload);
                        return true; //The callback is done after this handler returns
                    } //Ignore if details is not valid
                /**
                 * Forcefully close the sender tab.
                 */
                case "remove tab":
                    if (args[1].tab && args[1].tab.id !== chrome.tabs.TAB_ID_NONE) {
                        chrome.tabs.remove(args[1].tab.id, () => {
                            if (chrome.runtime.lastError) {
                                //Ignore, assume the tab is already closed
                            }
                        });
                    } //Ignore if not called from a proper tab
                    break;
                default:
                    //Invalid command, ignore
                    break;
            }
        } //No command, ignore
    });
    //Extension icon click handler, open options page
    chrome.browserAction.onClicked.addListener(() => {
        chrome.runtime.openOptionsPage();
    });
    //Set badge
    if (a.debugMode) {
        //Debug mode
        chrome.browserAction.setBadgeText({
            text: "DBG",
        });
        chrome.browserAction.setBadgeBackgroundColor({
            color: "#6996FF",
        });
    } else if (chrome.runtime.id !== "ggolfgbegefeeoocgjbmkembbncoadlb") {
        //Unpacked extension but not in debug mode
        chrome.browserAction.setBadgeText({
            text: "DEV",
        });
        chrome.browserAction.setBadgeBackgroundColor({
            color: "#25BA42",
        });
    } //No badge otherwise
};

//=====Utilities=====
/**
 * Get the URL of a tab.
 * @function
 * @param {integer} tab - The ID of the tab.
 * @param {integer} frame - The ID of the frame.
 * @return {string} The URL of the tab, or an empty string if it is not known.
 */
a.getTabURL = (() => {
    //The tabs database
    let tabs = {};
    if (a.debugMode) {
        //Expose private object in debug mode
        window.getTabURLInternal = tabs;
    }
    //Query existing tabs
    chrome.tabs.query({}, (existingTabs) => {
        for (let i = 0; i < existingTabs.length; i++) {
            const id = existingTabs[i].id;
            if (id !== chrome.tabs.TAB_ID_NONE) {
                if (!tabs[id]) {
                    tabs[id] = {};
                }
                //Only assign if it does not exist
                tabs[id][0] = tabs[id][0] || existingTabs[i].url;
                //Query frames
                chrome.webNavigation.getAllFrames({ tabId: id }, (frames) => {
                    //This can fail if the tab is closed at the right timing
                    if (!chrome.runtime.lastError && tabs[id]) {
                        for (let ii = 0; ii < frames.length; ii++) {
                            //Only assign if it does not exist
                            tabs[id][frames[ii].frameId] = tabs[id][frames[ii].frameId] || frames[ii].url;
                        }
                    }
                });
            }
        }
    });
    //Bind event handlers
    chrome.webNavigation.onCommitted.addListener((details) => {
        if (!tabs[details.tabId]) {
            tabs[details.tabId] = {};
        }
        tabs[details.tabId][details.frameId] = details.url;
    });
    chrome.tabs.onRemoved.addListener((id) => {
        //Free memory when tab is closed
        delete tabs[id];
    });
    //Return closure function
    return (tab, frame) => {
        if (tabs[tab]) {
            return tabs[tab][frame] || "";
        } else {
            return "";
        }
    };
})();
/**
 * Check if the domain of an URL ends with one of the domains in the list.
 * A list entry "example.com" will match domains that matches /(^|.*\.)example\.com$/.
 * @function
 * @param {string} url - The URL to check.
 * @param {Array.<string>} domList - The list of domains to compare.
 * @param {boolean} isMatch - Whether the domains list is a match list.
 * @return {boolean} True if the domain of the URL is in the list, false otherwise.
 */
a.domCmp = (() => {
    const domainExtractor = /^https?:\/\/([^/]+)/;
    return (url, domList, isMatch) => {
        let dom = domainExtractor.exec(url);
        if (!dom) {
            //Defaults to not match if the scheme is not supported or the URL is not valid
            return false;
        }
        dom = dom[1];
        //Loop though each element
        for (let i = 0; i < domList.length; i++) {
            if (dom.endsWith(domList[i]) &&
                (dom.length === domList[i].length || dom.charAt(dom.length - domList[i].length - 1) === '.')) {
                return true === isMatch;
            }
        }
        return false === isMatch;
    };
})();
/**
 * Register a static loopback server.
 * @function
 * @param {Array.<string>} urls - The urls to loopback.
 * @param {Array.<string>} types - The types of request to loopback.
 * @param {string} data - The data to loopback to, must be already encoded and ready to serve.
 * @param {Array.<string>} [domList=undefined] - The domains list, omit to match all domains.
 * @param {boolean} [isMatch=true] - Whether the domains list is a match list.
 */
a.staticServer = (urls, types, data, domList, isMatch = true) => {
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            if (!domList || a.domCmp(a.getTabURL(details.tabId, details.frameId), domList, isMatch)) {
                return { redirectUrl: data };
            }
        },
        {
            urls: urls,
            types: types,
        },
        [
            "blocking",
        ],
    );
};
/**
 * Register a dynamic loopback server.
 * @function
 * @param {Array.<string>} urls - The urls to loopback.
 * @param {Array.<string>} types - The types of request to loopback.
 * @param {Function} server - The server, this function will be passed as the event listener, view Chrome API
 ** documentations for more information: https://developer.chrome.com/extensions/webRequest
 * @param {Array.<string>} [domList=undefined] - The domains list, omit to match all domains.
 * @param {boolean} [isMatch=true] - Whether the domains list is a match list.
 */
a.dynamicServer = (urls, types, server, domList, isMatch = true) => {
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            if (!domList || a.domCmp(a.getTabURL(details.tabId, details.frameId), domList, isMatch)) {
                return server(details);
            }
        },
        {
            urls: urls,
            types: types,
        },
        [
            "blocking",
        ],
    );
};

//=====Generic=====
/**
 * Apply generic rules.
 * @function
 */
a.generic = () => {
    //---jQuery plugin---
    //Payload generator
    /*
    a.mkPayload("jQuery plugin", () => {
        "use strict";
        window.console.error("Uncaught Error: jQuery uBlock Origin detector plugin is not allowed on this device!");
        try {
            window.$.adblock = false;
        } catch (err) { }
        try {
            window.jQuery.adblock = false;
        } catch (err) { }
    });
    */
    a.staticServer(
        [
            "https://ads.korri.fr/index.js",
            "http://*.medianetworkinternational.com/js/advertisement.js*",
        ],
        [
            "script",
        ],
        "data:text/javascript;base64,KCgpID0+IHsidXNlIHN0cmljdCI7d2luZG93LmNvbnNvbGUuZXJyb3IoIlVuY2F1Z2h0IEVycm9yOiBqUXVlcnkgdUJsb2NrIE9yaWdpbiBkZXRlY3RvciBwbH" +
        "VnaW4gaXMgbm90IGFsbG93ZWQgb24gdGhpcyBkZXZpY2UhIik7dHJ5IHt3aW5kb3cuJC5hZGJsb2NrID0gZmFsc2U7fSBjYXRjaCAoZXJyKSB7IH10cnkge3dpbmRvdy5qUXVlcnkuYWRibG9jayA9" +
        "IGZhbHNlO30gY2F0Y2ggKGVycikgeyB9fSkoKTs=",
    );
    //---Interactive Media Ads Software Development Kit---
    //Payload generator
    /*
    //https://developers.google.com/interactive-media-ads/docs/sdks/html5/v3/apis
    a.mkPayload("IMA SDK", () => {
        "use strict";
        window.console.error("Uncaught Error: IMA SDK is not allowed on this device!");
        //I think I can get away with not implementing interfaces
        window.google = window.google || {};
        window.google.ima = {
            AdDisplayContainer: class {
                //constructor(container, video, click) { }
                initialize() { }
                destroy() { }
            },
            AdError: class extends Error {
                constructor(message, code, type) {
                    super(message);
                    this.code = code;
                    this.type = type;
                }
                getErrorCode() {
                    return this.code;
                }
                getInnerError() {
                    return null;
                }
                getMessage() {
                    return this.message;
                }
                getType() {
                    return this.type;
                }
                getVastErrorCode() {
                    return window.google.ima.AdError.ErrorCode.UNKNOWN_ERROR;
                }
            },
            AdErrorEvent: class extends ErrorEvent {
                constructor(error, context) {
                    super(error);
                    this.errObj = error;
                    this.context = context;
                }
                getError() {
                    return this.errObj;
                }
                getUserRequestContext() {
                    return this.context;
                }
            },
            AdEvent: class extends Event {
                constructor(type, ad, adData) {
                    super(type);
                    this.ad = ad;
                    this.adData = adData;
                }
                getAd() {
                    return this.ad;
                }
                getAdData() {
                    return this.adData;
                }
            },
            AdsLoader: class {
                //Event logic
                constructor() {
                    //Error event callbacks
                    this.onError = [];
                    this.onErrorScope = [];
                    //The error event object
                    this._error = new window.google.ima.AdErrorEvent(
                        new window.google.ima.AdError(
                            "No ads available",
                            window.google.ima.AdError.ErrorCode.VAST_NO_ADS_AFTER_WRAPPER,
                            window.google.ima.AdError.Type.AD_LOAD,
                        ),
                        {},
                    );
                }
                addEventListener(event, handler, capture, scope) {
                    //I think I can get away with returning error for all ads requests
                    //The whitelisted SDK would also always error out
                    if (event === window.google.ima.AdErrorEvent.Type.AD_ERROR) {
                        this.onError.push(handler);
                        this.onErrorScope.push(scope);
                    } else {
                        window.console.warn(`IMA event ${event} is ignored by uBlock Protector.`);
                    }
                }
                removeEventListener(event, handler) {
                    //capture and scope are not checked
                    if (event === window.google.ima.AdErrorEvent.Type.AD_ERROR) {
                        for (let i = 0; i < this.onError.length; i++) {
                            //This should be good enough
                            if (this.onError[i] === handler) {
                                this.onError.splice(i, 1);
                                this.onErrorScope.splice(i, 1);
                                i--;
                            }
                        }
                    }
                    //Ignore otherwise
                }
                _dispatchError() {
                    for (let i = 0; i < this.onError.length; i++) {
                        this.onError[i].call(this.onErrorScope[i] || window, this._error);
                    }
                }
                //Other logic
                contentComplete() {
                    window.setTimeout(this._dispatchError(), 10);
                }
                destroy() { }
                getSettings() {
                    return window.google.ima.settings;
                }
                requestAds() {
                    window.setTimeout(this._dispatchError(), 10);
                }
            },
            AdsManagerLoadedEvent: class extends Event {
                constructor() {
                    //I think I can get away with it as long as I do not dispatch the event
                    throw new window.Error("Neutralized AdsManager is not implemented.");
                }
            },
            AdsRenderingSettings: class {
                //I think I can get away with not defining anything
                //constructor() { }
            },
            AdsRequest: class {
                //I think I can get away with not defining anything
                //constructor() { }
                setAdWillAutoPlay() { }
            },
            CompanionAdSelectionSettings: class {
                //I think I can get away with not defining anything
                //constructor() { }
            },
            ImaSdkSettings: class {
                //I think I can get away with not defining anything
                //constructor() { }
                getCompanionBackfill() {
                    return window.google.ima.ImaSdkSettings.CompanionBackfillMode.ALWAYS;
                }
                getDisableCustomPlaybackForIOS10Plus() {
                    return false;
                }
                getDisableFlashAds() {
                    return true;
                }
                getLocale() {
                    return "en-CA";
                }
                getNumRedirects() {
                    return 1;
                }
                getPlayerType() {
                    return "Unknown";
                }
                getPlayerVersion() {
                    return "1.0.0";
                }
                getPpid() {
                    return "2GjCgoECAP0IbU";
                }
                //Hopefully this will not blow up
                setAutoPlayAdBreaks() { }
                setCompanionBackfill() { }
                setDisableCustomPlaybackForIOS10Plus() { }
                setDisableFlashAds() { }
                setLocale() { }
                setNumRedirects() { }
                setPlayerType() { }
                setPlayerVersion() { }
                setPpid() { }
                setVpaidAllowed() { }
                setVpaidMode() { }
            },
            UiElements: {
                COUNTDOWN: "countdown",
            },
            ViewMode: {
                FULLSCREEN: "fullscreen",
                NORMAL: "normal",
            },
            VERSION: "3.173.4",
        };
        //Nested properties
        window.google.ima.AdError.ErrorCode = {
            VIDEO_PLAY_ERROR: 400,
            FAILED_TO_REQUEST_ADS: 1005,
            REQUIRED_LISTENERS_NOT_ADDED: 900,
            VAST_LOAD_TIMEOUT: 301,
            VAST_NO_ADS_AFTER_WRAPPER: 303,
            VAST_MEDIA_LOAD_TIMEOUT: 402,
            VAST_TOO_MANY_REDIRECTS: 302,
            VAST_ASSET_MISMATCH: 403,
            VAST_LINEAR_ASSET_MISMATCH: 403,
            VAST_NONLINEAR_ASSET_MISMATCH: 503,
            VAST_ASSET_NOT_FOUND: 1007,
            VAST_UNSUPPORTED_VERSION: 102,
            VAST_SCHEMA_VALIDATION_ERROR: 101,
            VAST_TRAFFICKING_ERROR: 200,
            VAST_UNEXPECTED_LINEARITY: 201,
            VAST_UNEXPECTED_DURATION_ERROR: 202,
            VAST_WRAPPER_ERROR: 300,
            NONLINEAR_DIMENSIONS_ERROR: 501,
            COMPANION_REQUIRED_ERROR: 602,
            VAST_EMPTY_RESPONSE: 1009,
            UNSUPPORTED_LOCALE: 1011,
            INVALID_ADX_EXTENSION: 1105,
            INVALID_ARGUMENTS: 1101,
            UNKNOWN_AD_RESPONSE: 1010,
            UNKNOWN_ERROR: 900,
            OVERLAY_AD_PLAYING_FAILED: 500,
            VIDEO_ELEMENT_USED: -1,
            VIDEO_ELEMENT_REQUIRED: -1,
            VAST_MEDIA_ERROR: -1,
            ADSLOT_NOT_VISIBLE: -1,
            OVERLAY_AD_LOADING_FAILED: -1,
            VAST_MALFORMED_RESPONSE: -1,
            COMPANION_AD_LOADING_FAILED: -1,
        };
        window.google.ima.AdError.Type = {
            AD_LOAD: "adLoadError",
            AD_PLAY: "adPlayError",
        };
        window.google.ima.AdErrorEvent.Type = {
            AD_ERROR: "adError",
        };
        window.google.ima.AdEvent.Type = {
            CONTENT_RESUME_REQUESTED: "contentResumeRequested",
            CONTENT_PAUSE_REQUESTED: "contentPauseRequested",
            CLICK: "click",
            DURATION_CHANGE: "durationChange",
            EXPANDED_CHANGED: "expandedChanged",
            STARTED: "start",
            IMPRESSION: "impression",
            PAUSED: "pause",
            RESUMED: "resume",
            FIRST_QUARTILE: "firstquartile",
            MIDPOINT: "midpoint",
            THIRD_QUARTILE: "thirdquartile",
            COMPLETE: "complete",
            USER_CLOSE: "userClose",
            LINEAR_CHANGED: "linearChanged",
            LOADED: "loaded",
            AD_CAN_PLAY: "adCanPlay",
            AD_METADATA: "adMetadata",
            AD_BREAK_READY: "adBreakReady",
            INTERACTION: "interaction",
            ALL_ADS_COMPLETED: "allAdsCompleted",
            SKIPPED: "skip",
            SKIPPABLE_STATE_CHANGED: "skippableStateChanged",
            LOG: "log",
            VIEWABLE_IMPRESSION: "viewable_impression",
            VOLUME_CHANGED: "volumeChange",
            VOLUME_MUTED: "mute",
        };
        window.google.ima.AdsManagerLoadedEvent.Type = {
            ADS_MANAGER_LOADED: "adsManagerLoaded",
        };
        window.google.ima.CompanionAdSelectionSettings.CreativeType = {
            ALL: "All",
            FLASH: "Flash",
            IMAGE: "Image",
        };
        window.google.ima.CompanionAdSelectionSettings.ResourceType = {
            ALL: "All",
            HTML: "Html",
            IFRAME: "IFrame",
            STATIC: "Static",
        };
        window.google.ima.CompanionAdSelectionSettings.SizeCriteria = {
            IGNORE: "IgnoreSize",
            SELECT_EXACT_MATCH: "SelectExactMatch",
            SELECT_NEAR_MATCH: "SelectNearMatch",
        };
        window.google.ima.ImaSdkSettings.CompanionBackfillMode = {
            ALWAYS: "always",
            ON_MASTER_AD: "on_master_ad",
        };
        window.google.ima.ImaSdkSettings.VpaidMode = {
            DISABLED: 0,
            ENABLED: 1,
            INSECURE: 2,
        };
        //Initialization
        window.google.ima.settings = new window.google.ima.ImaSdkSettings();
    });
    */
    a.staticServer(
        [
            "https://imasdk.googleapis.com/js/sdkloader/ima3.js*",
            "http://imasdk.googleapis.com/js/sdkloader/ima3.js*",
        ],
        [
            "script",
        ],
        "data:text/javascript;base64,KCgpID0+IHsidXNlIHN0cmljdCI7d2luZG93LmNvbnNvbGUuZXJyb3IoIlVuY2F1Z2h0IEVycm9yOiBJTUEgU0RLIGlzIG5vdCBhbGxvd2VkIG9uIHRoaXMgZG" +
        "V2aWNlISIpO3dpbmRvdy5nb29nbGUgPSB3aW5kb3cuZ29vZ2xlIHx8IHt9O3dpbmRvdy5nb29nbGUuaW1hID0ge0FkRGlzcGxheUNvbnRhaW5lcjogY2xhc3Mge2luaXRpYWxpemUoKSB7IH1kZXN0" +
        "cm95KCkgeyB9fSxBZEVycm9yOiBjbGFzcyBleHRlbmRzIEVycm9yIHtjb25zdHJ1Y3RvcihtZXNzYWdlLCBjb2RlLCB0eXBlKSB7c3VwZXIobWVzc2FnZSk7dGhpcy5jb2RlID0gY29kZTt0aGlzLn" +
        "R5cGUgPSB0eXBlO31nZXRFcnJvckNvZGUoKSB7cmV0dXJuIHRoaXMuY29kZTt9Z2V0SW5uZXJFcnJvcigpIHtyZXR1cm4gbnVsbDt9Z2V0TWVzc2FnZSgpIHtyZXR1cm4gdGhpcy5tZXNzYWdlO31n" +
        "ZXRUeXBlKCkge3JldHVybiB0aGlzLnR5cGU7fWdldFZhc3RFcnJvckNvZGUoKSB7cmV0dXJuIHdpbmRvdy5nb29nbGUuaW1hLkFkRXJyb3IuRXJyb3JDb2RlLlVOS05PV05fRVJST1I7fX0sQWRFcn" +
        "JvckV2ZW50OiBjbGFzcyBleHRlbmRzIEVycm9yRXZlbnQge2NvbnN0cnVjdG9yKGVycm9yLCBjb250ZXh0KSB7c3VwZXIoZXJyb3IpO3RoaXMuZXJyT2JqID0gZXJyb3I7dGhpcy5jb250ZXh0ID0g" +
        "Y29udGV4dDt9Z2V0RXJyb3IoKSB7cmV0dXJuIHRoaXMuZXJyT2JqO31nZXRVc2VyUmVxdWVzdENvbnRleHQoKSB7cmV0dXJuIHRoaXMuY29udGV4dDt9fSxBZEV2ZW50OiBjbGFzcyBleHRlbmRzIE" +
        "V2ZW50IHtjb25zdHJ1Y3Rvcih0eXBlLCBhZCwgYWREYXRhKSB7c3VwZXIodHlwZSk7dGhpcy5hZCA9IGFkO3RoaXMuYWREYXRhID0gYWREYXRhO31nZXRBZCgpIHtyZXR1cm4gdGhpcy5hZDt9Z2V0" +
        "QWREYXRhKCkge3JldHVybiB0aGlzLmFkRGF0YTt9fSxBZHNMb2FkZXI6IGNsYXNzIHtjb25zdHJ1Y3RvcigpIHt0aGlzLm9uRXJyb3IgPSBbXTt0aGlzLm9uRXJyb3JTY29wZSA9IFtdO3RoaXMuX2" +
        "Vycm9yID0gbmV3IHdpbmRvdy5nb29nbGUuaW1hLkFkRXJyb3JFdmVudChuZXcgd2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvcigiTm8gYWRzIGF2YWlsYWJsZSIsd2luZG93Lmdvb2dsZS5pbWEuQWRF" +
        "cnJvci5FcnJvckNvZGUuVkFTVF9OT19BRFNfQUZURVJfV1JBUFBFUix3aW5kb3cuZ29vZ2xlLmltYS5BZEVycm9yLlR5cGUuQURfTE9BRCwpLHt9LCk7fWFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIG" +
        "hhbmRsZXIsIGNhcHR1cmUsIHNjb3BlKSB7aWYgKGV2ZW50ID09PSB3aW5kb3cuZ29vZ2xlLmltYS5BZEVycm9yRXZlbnQuVHlwZS5BRF9FUlJPUikge3RoaXMub25FcnJvci5wdXNoKGhhbmRsZXIp" +
        "O3RoaXMub25FcnJvclNjb3BlLnB1c2goc2NvcGUpO30gZWxzZSB7d2luZG93LmNvbnNvbGUud2FybihgSU1BIGV2ZW50ICR7ZXZlbnR9IGlzIGlnbm9yZWQgYnkgdUJsb2NrIFByb3RlY3Rvci5gKT" +
        "t9fXJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIpIHtpZiAoZXZlbnQgPT09IHdpbmRvdy5nb29nbGUuaW1hLkFkRXJyb3JFdmVudC5UeXBlLkFEX0VSUk9SKSB7Zm9yIChsZXQgaSA9" +
        "IDA7IGkgPCB0aGlzLm9uRXJyb3IubGVuZ3RoOyBpKyspIHtpZiAodGhpcy5vbkVycm9yW2ldID09PSBoYW5kbGVyKSB7dGhpcy5vbkVycm9yLnNwbGljZShpLCAxKTt0aGlzLm9uRXJyb3JTY29wZS" +
        "5zcGxpY2UoaSwgMSk7aS0tO319fX1fZGlzcGF0Y2hFcnJvcigpIHtmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMub25FcnJvci5sZW5ndGg7IGkrKykge3RoaXMub25FcnJvcltpXS5jYWxsKHRoaXMu" +
        "b25FcnJvclNjb3BlW2ldIHx8IHdpbmRvdywgdGhpcy5fZXJyb3IpO319Y29udGVudENvbXBsZXRlKCkge3dpbmRvdy5zZXRUaW1lb3V0KHRoaXMuX2Rpc3BhdGNoRXJyb3IoKSwgMTApO31kZXN0cm" +
        "95KCkgeyB9Z2V0U2V0dGluZ3MoKSB7cmV0dXJuIHdpbmRvdy5nb29nbGUuaW1hLnNldHRpbmdzO31yZXF1ZXN0QWRzKCkge3dpbmRvdy5zZXRUaW1lb3V0KHRoaXMuX2Rpc3BhdGNoRXJyb3IoKSwg" +
        "MTApO319LEFkc01hbmFnZXJMb2FkZWRFdmVudDogY2xhc3MgZXh0ZW5kcyBFdmVudCB7Y29uc3RydWN0b3IoKSB7dGhyb3cgbmV3IHdpbmRvdy5FcnJvcigiTmV1dHJhbGl6ZWQgQWRzTWFuYWdlci" +
        "BpcyBub3QgaW1wbGVtZW50ZWQuIik7fX0sQWRzUmVuZGVyaW5nU2V0dGluZ3M6IGNsYXNzIHt9LEFkc1JlcXVlc3Q6IGNsYXNzIHtzZXRBZFdpbGxBdXRvUGxheSgpIHsgfX0sQ29tcGFuaW9uQWRT" +
        "ZWxlY3Rpb25TZXR0aW5nczogY2xhc3Mge30sSW1hU2RrU2V0dGluZ3M6IGNsYXNzIHtnZXRDb21wYW5pb25CYWNrZmlsbCgpIHtyZXR1cm4gd2luZG93Lmdvb2dsZS5pbWEuSW1hU2RrU2V0dGluZ3" +
        "MuQ29tcGFuaW9uQmFja2ZpbGxNb2RlLkFMV0FZUzt9Z2V0RGlzYWJsZUN1c3RvbVBsYXliYWNrRm9ySU9TMTBQbHVzKCkge3JldHVybiBmYWxzZTt9Z2V0RGlzYWJsZUZsYXNoQWRzKCkge3JldHVy" +
        "biB0cnVlO31nZXRMb2NhbGUoKSB7cmV0dXJuICJlbi1DQSI7fWdldE51bVJlZGlyZWN0cygpIHtyZXR1cm4gMTt9Z2V0UGxheWVyVHlwZSgpIHtyZXR1cm4gIlVua25vd24iO31nZXRQbGF5ZXJWZX" +
        "JzaW9uKCkge3JldHVybiAiMS4wLjAiO31nZXRQcGlkKCkge3JldHVybiAiMkdqQ2dvRUNBUDBJYlUiO31zZXRBdXRvUGxheUFkQnJlYWtzKCkgeyB9c2V0Q29tcGFuaW9uQmFja2ZpbGwoKSB7IH1z" +
        "ZXREaXNhYmxlQ3VzdG9tUGxheWJhY2tGb3JJT1MxMFBsdXMoKSB7IH1zZXREaXNhYmxlRmxhc2hBZHMoKSB7IH1zZXRMb2NhbGUoKSB7IH1zZXROdW1SZWRpcmVjdHMoKSB7IH1zZXRQbGF5ZXJUeX" +
        "BlKCkgeyB9c2V0UGxheWVyVmVyc2lvbigpIHsgfXNldFBwaWQoKSB7IH1zZXRWcGFpZEFsbG93ZWQoKSB7IH1zZXRWcGFpZE1vZGUoKSB7IH19LFVpRWxlbWVudHM6IHtDT1VOVERPV046ICJjb3Vu" +
        "dGRvd24iLH0sVmlld01vZGU6IHtGVUxMU0NSRUVOOiAiZnVsbHNjcmVlbiIsTk9STUFMOiAibm9ybWFsIix9LFZFUlNJT046ICIzLjE3My40Iix9O3dpbmRvdy5nb29nbGUuaW1hLkFkRXJyb3IuRX" +
        "Jyb3JDb2RlID0ge1ZJREVPX1BMQVlfRVJST1I6IDQwMCxGQUlMRURfVE9fUkVRVUVTVF9BRFM6IDEwMDUsUkVRVUlSRURfTElTVEVORVJTX05PVF9BRERFRDogOTAwLFZBU1RfTE9BRF9USU1FT1VU" +
        "OiAzMDEsVkFTVF9OT19BRFNfQUZURVJfV1JBUFBFUjogMzAzLFZBU1RfTUVESUFfTE9BRF9USU1FT1VUOiA0MDIsVkFTVF9UT09fTUFOWV9SRURJUkVDVFM6IDMwMixWQVNUX0FTU0VUX01JU01BVE" +
        "NIOiA0MDMsVkFTVF9MSU5FQVJfQVNTRVRfTUlTTUFUQ0g6IDQwMyxWQVNUX05PTkxJTkVBUl9BU1NFVF9NSVNNQVRDSDogNTAzLFZBU1RfQVNTRVRfTk9UX0ZPVU5EOiAxMDA3LFZBU1RfVU5TVVBQ" +
        "T1JURURfVkVSU0lPTjogMTAyLFZBU1RfU0NIRU1BX1ZBTElEQVRJT05fRVJST1I6IDEwMSxWQVNUX1RSQUZGSUNLSU5HX0VSUk9SOiAyMDAsVkFTVF9VTkVYUEVDVEVEX0xJTkVBUklUWTogMjAxLF" +
        "ZBU1RfVU5FWFBFQ1RFRF9EVVJBVElPTl9FUlJPUjogMjAyLFZBU1RfV1JBUFBFUl9FUlJPUjogMzAwLE5PTkxJTkVBUl9ESU1FTlNJT05TX0VSUk9SOiA1MDEsQ09NUEFOSU9OX1JFUVVJUkVEX0VS" +
        "Uk9SOiA2MDIsVkFTVF9FTVBUWV9SRVNQT05TRTogMTAwOSxVTlNVUFBPUlRFRF9MT0NBTEU6IDEwMTEsSU5WQUxJRF9BRFhfRVhURU5TSU9OOiAxMTA1LElOVkFMSURfQVJHVU1FTlRTOiAxMTAxLF" +
        "VOS05PV05fQURfUkVTUE9OU0U6IDEwMTAsVU5LTk9XTl9FUlJPUjogOTAwLE9WRVJMQVlfQURfUExBWUlOR19GQUlMRUQ6IDUwMCxWSURFT19FTEVNRU5UX1VTRUQ6IC0xLFZJREVPX0VMRU1FTlRf" +
        "UkVRVUlSRUQ6IC0xLFZBU1RfTUVESUFfRVJST1I6IC0xLEFEU0xPVF9OT1RfVklTSUJMRTogLTEsT1ZFUkxBWV9BRF9MT0FESU5HX0ZBSUxFRDogLTEsVkFTVF9NQUxGT1JNRURfUkVTUE9OU0U6IC" +
        "0xLENPTVBBTklPTl9BRF9MT0FESU5HX0ZBSUxFRDogLTEsfTt3aW5kb3cuZ29vZ2xlLmltYS5BZEVycm9yLlR5cGUgPSB7QURfTE9BRDogImFkTG9hZEVycm9yIixBRF9QTEFZOiAiYWRQbGF5RXJy" +
        "b3IiLH07d2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvckV2ZW50LlR5cGUgPSB7QURfRVJST1I6ICJhZEVycm9yIix9O3dpbmRvdy5nb29nbGUuaW1hLkFkRXZlbnQuVHlwZSA9IHtDT05URU5UX1JFU1" +
        "VNRV9SRVFVRVNURUQ6ICJjb250ZW50UmVzdW1lUmVxdWVzdGVkIixDT05URU5UX1BBVVNFX1JFUVVFU1RFRDogImNvbnRlbnRQYXVzZVJlcXVlc3RlZCIsQ0xJQ0s6ICJjbGljayIsRFVSQVRJT05f" +
        "Q0hBTkdFOiAiZHVyYXRpb25DaGFuZ2UiLEVYUEFOREVEX0NIQU5HRUQ6ICJleHBhbmRlZENoYW5nZWQiLFNUQVJURUQ6ICJzdGFydCIsSU1QUkVTU0lPTjogImltcHJlc3Npb24iLFBBVVNFRDogIn" +
        "BhdXNlIixSRVNVTUVEOiAicmVzdW1lIixGSVJTVF9RVUFSVElMRTogImZpcnN0cXVhcnRpbGUiLE1JRFBPSU5UOiAibWlkcG9pbnQiLFRISVJEX1FVQVJUSUxFOiAidGhpcmRxdWFydGlsZSIsQ09N" +
        "UExFVEU6ICJjb21wbGV0ZSIsVVNFUl9DTE9TRTogInVzZXJDbG9zZSIsTElORUFSX0NIQU5HRUQ6ICJsaW5lYXJDaGFuZ2VkIixMT0FERUQ6ICJsb2FkZWQiLEFEX0NBTl9QTEFZOiAiYWRDYW5QbG" +
        "F5IixBRF9NRVRBREFUQTogImFkTWV0YWRhdGEiLEFEX0JSRUFLX1JFQURZOiAiYWRCcmVha1JlYWR5IixJTlRFUkFDVElPTjogImludGVyYWN0aW9uIixBTExfQURTX0NPTVBMRVRFRDogImFsbEFk" +
        "c0NvbXBsZXRlZCIsU0tJUFBFRDogInNraXAiLFNLSVBQQUJMRV9TVEFURV9DSEFOR0VEOiAic2tpcHBhYmxlU3RhdGVDaGFuZ2VkIixMT0c6ICJsb2ciLFZJRVdBQkxFX0lNUFJFU1NJT046ICJ2aW" +
        "V3YWJsZV9pbXByZXNzaW9uIixWT0xVTUVfQ0hBTkdFRDogInZvbHVtZUNoYW5nZSIsVk9MVU1FX01VVEVEOiAibXV0ZSIsfTt3aW5kb3cuZ29vZ2xlLmltYS5BZHNNYW5hZ2VyTG9hZGVkRXZlbnQu" +
        "VHlwZSA9IHtBRFNfTUFOQUdFUl9MT0FERUQ6ICJhZHNNYW5hZ2VyTG9hZGVkIix9O3dpbmRvdy5nb29nbGUuaW1hLkNvbXBhbmlvbkFkU2VsZWN0aW9uU2V0dGluZ3MuQ3JlYXRpdmVUeXBlID0ge0" +
        "FMTDogIkFsbCIsRkxBU0g6ICJGbGFzaCIsSU1BR0U6ICJJbWFnZSIsfTt3aW5kb3cuZ29vZ2xlLmltYS5Db21wYW5pb25BZFNlbGVjdGlvblNldHRpbmdzLlJlc291cmNlVHlwZSA9IHtBTEw6ICJB" +
        "bGwiLEhUTUw6ICJIdG1sIixJRlJBTUU6ICJJRnJhbWUiLFNUQVRJQzogIlN0YXRpYyIsfTt3aW5kb3cuZ29vZ2xlLmltYS5Db21wYW5pb25BZFNlbGVjdGlvblNldHRpbmdzLlNpemVDcml0ZXJpYS" +
        "A9IHtJR05PUkU6ICJJZ25vcmVTaXplIixTRUxFQ1RfRVhBQ1RfTUFUQ0g6ICJTZWxlY3RFeGFjdE1hdGNoIixTRUxFQ1RfTkVBUl9NQVRDSDogIlNlbGVjdE5lYXJNYXRjaCIsfTt3aW5kb3cuZ29v" +
        "Z2xlLmltYS5JbWFTZGtTZXR0aW5ncy5Db21wYW5pb25CYWNrZmlsbE1vZGUgPSB7QUxXQVlTOiAiYWx3YXlzIixPTl9NQVNURVJfQUQ6ICJvbl9tYXN0ZXJfYWQiLH07d2luZG93Lmdvb2dsZS5pbW" +
        "EuSW1hU2RrU2V0dGluZ3MuVnBhaWRNb2RlID0ge0RJU0FCTEVEOiAwLEVOQUJMRUQ6IDEsSU5TRUNVUkU6IDIsfTt3aW5kb3cuZ29vZ2xlLmltYS5zZXR0aW5ncyA9IG5ldyB3aW5kb3cuZ29vZ2xl" +
        "LmltYS5JbWFTZGtTZXR0aW5ncygpO30pKCk7",
    );
    //---MoatFreeWheelJSPEM.js---
    //Payload generator
    /*
    a.mkPayload("MoatFreeWheelJSPEM.js", () => {
        "use strict";
        window.console.error("Uncaught Error: FreeWheel SDK is not allowed on this device!");
        window.MoatFreeWheelJSPEM = class {
            init() { }
            dispose() { }
        };
    });
    */
    a.staticServer(
        [
            "https://jspenguin.com/API/uBlockProtector/Solutions/MoatFreeWheelJSPEM.js",
            "https://*.moatads.com/*/MoatFreeWheelJSPEM.js*",
        ],
        [
            "script",
        ],
        "data:text/javascript;base64,KCgpID0+IHsidXNlIHN0cmljdCI7d2luZG93LmNvbnNvbGUuZXJyb3IoIlVuY2F1Z2h0IEVycm9yOiBGcmVlV2hlZWwgU0RLIGlzIG5vdCBhbGxvd2VkIG9uIH" +
        "RoaXMgZGV2aWNlISIpO3dpbmRvdy5Nb2F0RnJlZVdoZWVsSlNQRU0gPSBjbGFzcyB7aW5pdCgpIHsgfWRpc3Bvc2UoKSB7IH19O30pKCk7",
    );
};

//=====Debug Utilities=====
/**
 * Attempt to make the server think the request is from a different IP.
 * This function is for debugging purposes only, and is only available in debug mode.
 * @function
 * @param {string} urls - The URLs to activate on.
 * @param {string} ip - The IP.
 * @param {boolean} [log=false] - Whether details should be logged to console for every matched request.
 */
a.proxy = (urls, ip, log) => {
    if (!a.debugMode) {
        console.error("a.proxy() is only available in debug mode!");
        return;
    }
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            details.requestHeaders.push({
                name: "X-Forwarded-For",
                value: ip,
            });
            details.requestHeaders.push({
                name: "Client-IP",
                value: ip,
            });
            if (log) {
                console.log(details);
            }
            return { requestHeaders: details.requestHeaders };
        },
        {
            urls: urls,
        },
        [
            "blocking",
            "requestHeaders",
        ],
    );
};
/**
 * Make data URL and pretty print it into the console.
 * Only available in debug mode.
 * @function
 * @param {string} title - The name of the payload.
 * @param {Function} payload - The payload.
 * @param {string} [type="text/javascript"] - The MIME type of the payload.
 * @return {string} The URL encoded payload.
 */
a.mkPayload = (title, payload, type = "text/javascript") => {
    if (!a.debugMode) {
        console.error("a.mkPayload() is only available in debug mode!");
        return;
    }
    //Trim each line to make it smaller
    let lines = (`(${payload})();`).split("\n");
    for (let i = 0; i < lines.length; i++) {
        lines[i] = lines[i].trim();
        //Remove comments
        if (lines[i].startsWith("//")) {
            lines.splice(i, 1);
            i--;
        }
    }
    //Encode and pretty print
    payload = `data:${type};base64,` + btoa(lines.join(""));
    let output = "";
    while (payload) {
        output += `"${payload.substring(0, 150)}" +\n`;
        payload = payload.substring(150);
    }
    console.log(title);
    console.log(output);
};