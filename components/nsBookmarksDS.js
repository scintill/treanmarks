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
 * Contributor(s):
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

/*
 * This is an RDF datasource at rdf:bookmarks.  It replaces the built-in
 * datasource, aggregating that one and the TreanMarks DS.  Because parts
 * of the browser QueryInterface() the DS into the bookmarks service, we
 * must allow the same.
 */

dump("registering nsBookmarksDS\n");

// From a combination of
// http://ted.mielczarek.org/code/mozilla/jscomponentwiz/ and
// http://hyperstruct.net/2006/8/10/your-first-javascript-xpcom-component-in-10-minutes

const Cc = Components.classes,
      Ci = Components.interfaces,
      Cr = Components.results;
const loader = Cc['@mozilla.org/moz/jssubscript-loader;1']
    .getService(Ci.mozIJSSubScriptLoader);

const CLASS_ID = Components.ID("18e08407-0306-4db0-b226-a4ebf4700ccb");
const CLASS_NAME = "TreanMarks RDF Datasource";
const CONTRACT_ID = "@mozilla.org/rdf/datasource;1?name=bookmarks";

// Component
function BookmarksDS() {}
BookmarksDS.prototype = {};
[
"chrome://treanmarks/content/nsBookmarksDS.js",
"chrome://treanmarks/content/lib.js",
"chrome://treanmarks/content/rdf_lib.js",
"chrome://treanmarks/content/xpcom_lib.js"
].forEach(function(f) { loader.loadSubScript(f, BookmarksDS.prototype); });

// Factory
var BookmarksDSFactory = {
    singleton: null,
    createInstance: function (aOuter, aIID) {
        if (aOuter != null)
            throw Components.results.NS_ERROR_NO_AGGREGATION;
        if (this.singleton == null)
            this.singleton = new BookmarksDS();
        return this.singleton.QueryInterface(aIID);
    }
};

// Module
var BookmarksDSModule = {
    registerSelf: function(aCompMgr, aFileSpec, aLocation, aType) {
        aCompMgr = aCompMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
        aCompMgr.registerFactoryLocation(CLASS_ID, CLASS_NAME,
          CONTRACT_ID, aFileSpec, aLocation, aType);
    },

    unregisterSelf: function(aCompMgr, aLocation, aType) {
        aCompMgr = aCompMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
        aCompMgr.unregisterFactoryLocation(CLASS_ID, aLocation);        
    },
  
    getClassObject: function(aCompMgr, aCID, aIID) {
        if (!aIID.equals(Components.interfaces.nsIFactory))
            throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

        if (aCID.equals(CLASS_ID))
            return BookmarksDSFactory;

        throw Components.results.NS_ERROR_NO_INTERFACE;
    },

    canUnload: function(aCompMgr) { return true; }
};

// module initialization
function NSGetModule(aCompMgr, aFileSpec) { return BookmarksDSModule; }
