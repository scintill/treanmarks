/* ***** BEGIN LICENSE BLOCK *****
 *   Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 * 
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is TreanMarks.
 *
 * The Initial Developer of the Original Code is
 * Joey Hewitt.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 * 
 * ***** END LICENSE BLOCK ***** */

/**
 * This could be cleaned up a bit and probably work as a general-purpose
 * JSON/RPC client.
 */

// JsonRpc.Request
var JsonRpc = {};
JsonRpc.Request = Class.create();

JsonRpc.Request.setDefaultServerUrl = function(defaultServerUrl) {
    JsonRpc.Request.prototype._defaultServerUrl = defaultServerUrl;
};

JsonRpc.Request.prototype = {
    _prompts : Cc['@mozilla.org/embedcomp/prompt-service;1']
      .getService(Ci.nsIPromptService),
    _windowWatcher : Cc['@mozilla.org/embedcomp/window-watcher;1']
      .getService(Ci.nsIWindowWatcher),

    initialize: function(method, params, callback, serverUrl /*= null*/) {
        // Looks like some kind of cross-window problems with XMLHttpRequest.
        // See http://groups.google.com/group/comp.lang.javascript/browse_thread/thread/5b414aa1550a7698/1e85eec1cd76e45a?q=0x80040111+(NS_ERROR_NOT_AVAILABLE)&rnum=6#1e85eec1cd76e45a
        // I got the workaround from there

        // Bind callback to the caller's scope
        if (callback)
            callback = bind(callback, arguments.callee.caller);

        Prototype.setTimeout(bind(
            function() { this._real_initialize(method, params, callback, serverUrl); },
        this), 0);
    },

    _real_initialize: function(method, params, callback, serverUrl /*= null*/) {
        var reqData = { method : method, params : params, id : 0 };
        var myJsonRequest = this;
        var myRequest = new Ajax.Request(serverUrl || this._defaultServerUrl, {
            method : 'post',
            contentType : 'application/json',
            requestHeaders : {
                'Accept' : 'application/json'
            },
            postBody : Object.toJSON(reqData),

            onSuccess : function(transport) {
                var status = new JsonRpc.Status(transport.status, false, false);
                var resp;
                //dump("JsonRPC: OK "+myRequest.transport.responseText+"\n");
                try {
                    resp = myRequest.transport.responseText.evalJSON(true);
                    myJsonRequest._takeHints(resp);
                } catch (e) {
                    resp = null;
                    status.setIsJsonError();
                    throw e;
                }
                if (callback)
                    callback(resp, status);
            },
            onFailure : function(transport) {
                dump("JsonRPC: Fail\n");
                var status = new JsonRpc.Status(transport.status, true, false);
                callback(null, status);
            },
            onException : function(reqobj, e) {
                dump("JsonRPC: Exception: "+e+"\n");
                throw e;
            }
        });

        this._thisRequest = myRequest;

        /*
         * The magic XPConnect password-handling stuff.
         */
        var chan = myRequest.transport.channel.
          QueryInterface(Ci.nsIChannel);
        chan.notificationCallbacks = this;
    },
    
    // from nsIAuthPrompt interface
    promptUsernameAndPassword:
      function(dialogTitle, text, passwordRealm, savePassword, user, pass) {
        if (this._suppressAuth)
            return false;

        this._loadCreds(user, pass);
        var saveInManager = { value : false };

        while( !(user.value && user.value.length) ||
          !(pass.value && pass.value.length) ) {
            var ok =
              this._prompts.promptUsernameAndPassword(
                this._windowWatcher.activeWindow,
                this._("authDialogTitle"),
                this._("authDialogText", this._thisRequest.url),
                user, pass, this._("authDialogRememberLabel"), saveInManager);

            if (!ok) {
                this._suppressAuth = true;
                this._authCanceled = true;
                return false;
            }
            if (saveInManager.value)
                this._saveCreds(user, pass);
        }
        return true;
    },

    // Localization
    // Thanks a lot to bookmarks.js
    _ : function(aStringKey, aReplaceString) {
        if (!this._bundle) {
            var LOCALESVC = Cc['@mozilla.org/intl/nslocaleservice;1']
                                    .getService(Ci.nsILocaleService);
            var BUNDLESVC = Cc['@mozilla.org/intl/stringbundle;1']
                                    .getService(Ci.nsIStringBundleService);
            var treanmarksBundle  =
              'chrome://treanmarks/locale/treanmarks.properties';
            this._bundle         = BUNDLESVC.createBundle(treanmarksBundle,
              LOCALESVC.getApplicationLocale());
        }
       
        var bundle;
        try {
            if (!aReplaceString)
                bundle = this._bundle.GetStringFromName(aStringKey);
            else if (typeof(aReplaceString) == 'string')
                bundle = this._bundle.formatStringFromName(aStringKey, [aReplaceString], 1);
            else
                bundle = this._bundle.formatStringFromName(aStringKey, aReplaceString, aReplaceString.length);
        } catch (e) {
            dump("Localization needed for "+aStringKey);
            bundle = "!!\""+aStringKey+"\"!!";
        }
        
        return bundle;
    },

    /**
     * Mozilla interface glue for password handling.  Basics lifted from
     * from Firefox's components/nsXmlRpcClient.js
     */
    // nsISupports interface
    QueryInterface: function(iid) {
        if (!iid.equals(Ci.nsISupports) &&
            !iid.equals(Ci.nsIInterfaceRequestor))
            throw Cr.NS_ERROR_NO_INTERFACE;
        return this;
    },

    // nsIInterfaceRequester interface
    getInterface: function(iid, result) {
        if (iid.equals(Ci.nsIAuthPrompt))
            return this;
        Components.returnCode = Cr.NS_ERROR_NO_INTERFACE;
        return null;
    },

    // Interface to Firefox password manager
    _loadCreds: function(user, pass) {
        var url = { value : null };
        var man = Cc['@mozilla.org/passwordmanager;1'].
          createInstance(Ci.nsIPasswordManagerInternal);
        try {
            // this is from nsIPasswordManagerInternal ... could be bad to use?
            // params are host, username, password, outHost, outUser, outPass
            man.findPasswordEntry('treanmarksExtension', '', '',
              url, user, pass);
        } catch (err) {}
    },
    
    _saveCreds: function(user, pass) {
        var man = Cc['@mozilla.org/passwordmanager;1'].
            createInstance(Ci.nsIPasswordManager);
        man.addUser('treanmarksExtension', user.value, pass.value);
    },
    //

    // Take the hint ;), when __jsonclass__ hinting is used
    _takeHints: function(data) {
        /*
         * http://json-rpc.org/wiki/specification#a3.JSONClasshinting
         * Objects with property
         * __jsonclass__:["obj",[params...],"prop1":...] gets constructed
         * and properties applied
         *
         * Inspired by
         * http://dojotoolkit.org/pipermail/dojo-interest/2006-July/012311.html
         *
         * I learned some new things about JS when I concocted this, so
         * hopefully this is the best way...
         */
        for (var k in data) {
            if (typeof data[k] != "object" || data[k] == null)
                continue;
            if (data[k].__jsonclass__) {
                var cl = data[k].__jsonclass__;
                delete data[k].__jsonclass__;
                // Sanitize before eval!
                if (!cl[0].match(/^[a-z_$][a-z_$0-9]*$/i)) {
                    throw new Error("invalid identifier specified for type " +
                      "with __jsonclass__ hinting");
                }
                // I guess some of this sort of emulates 'new' (correctly?).
                // Eval to dynamically lookup the constructor for the object.
                // Call the constructor, then extend the object with any
                // user-specified properties.
                var ob = eval(cl[0]);
                data[k] = Object.extend(
                    ob.apply((ob.prototype || {}), cl.slice(1)),
                  data[k]);
            } else {
                this._takeHints(data[k]);
            }
        }
    }

}

// Status object
JsonRpc.Status = Class.create();
JsonRpc.Status.prototype = {

    initialize: function(httpStatus, isError, isTimeout) {
        this._httpStatus = httpStatus;
        this._isError = isError;
        this._isTimeout = isTimeout;
    },
    getHttpStatus: function() { return this._httpStatus },
    isError: function() { return this._isError },
    isTimeout: function() { return this._isTimeout },

    setIsJsonError: function() { this._isJsonError = true },
    isJsonError: function() { return this._isJsonError }

}
