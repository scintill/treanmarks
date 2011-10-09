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

// They seem to already be defined somewhere
/*
const Cc = Components.classes,
      Ci = Components.interfaces;
      Cr = Components.results;
*/

const g_loader = Cc['@mozilla.org/moz/jssubscript-loader;1']
    .getService(Ci.mozIJSSubScriptLoader);

function TreanMarks() {}
TreanMarks.prototype = {};
g_loader.loadSubScript("chrome://treanmarks/content/lib.js", TreanMarks.prototype);
g_loader.loadSubScript("chrome://treanmarks/content/prototype.js");
// bookmarks code gets loaded into bmc (bmc = "bookmarks code" namespace)
Object.extend(TreanMarks.prototype, {
    _onInit : function() {
        this.RDF = Cc["@mozilla.org/rdf/rdf-service;1"]
                  .getService(Ci.nsIRDFService);

        // prefs
        this._initPrefs();

        // register for notif's about Trean server errors
        var observServ = Cc["@mozilla.org/observer-service;1"].
                           getService(Ci.nsIObserverService);
        observServ.addObserver(this, 'nsTreanMarksDS:error', false);

        // menus/datasource
        this._createMenu(this._prefs.getBoolPref("bSeparateMenus"));
        // unregister rdf:bookmarks, so ours overrides it
        // (we have the proper contract ID, so that when RDF service wants
        // rdf:bookmarks, it comes to us instead of the normal source)
        this.RDF.UnregisterDataSource(this.RDF.GetDataSource("rdf:bookmarks"));
    },

    _createMenu : function(bCreate) {
        var tmMenu, bmMenu;

        dump("createMenu "+bCreate+"\n");

        // if bCreate is false, actually get rid of the menu
        if (!bCreate) {
            tmMenu = document.getElementById("treanmarks-menu");
            if (tmMenu) {
                tmMenu.parentNode.removeChild(tmMenu);
            }
            delete this.bmc; // I'm thrifty with my memory; unload code&data
            return;
        }

        // create node
        bmMenu = document.getElementById("bookmarks-menu");
        tmMenu = bmMenu.cloneNode(true);
        tmMenu.id = "treanmarks-menu";      
        tmMenu.setAttribute("label", this._("treanmarksMenuName"));
        tmMenu.setAttribute("accesskey", this._("treanmarksMenuKey"));
        tmMenu.datasources = "rdf:treanmarks";
        tmMenu.ref = "http://trean.horde.org/rdfns/0.1#ROOT";
        // add to menubar
        bmMenu.parentNode.insertBefore(tmMenu, bmMenu);

/*
        // fixup code
        // load copies of code if necessary (copy, to replace rdf:bookmarks
        // with rdf:treanmarks)
        if (!this.bmc) {
            this.bmc = {};
            g_loader.loadSubScript("chrome://browser/content/bookmarks/bookmarks.js", this.bmc);
            g_loader.loadSubScript("chrome://browser/content/bookmarks/bookmarksMenu.js", this.bmc);
            // rebind all code to this new namespace
            this._rebind(this.bmc, this.bmc);
            dump("/REBIND\n");
            // override BMDS to point to TreanMarks - instead of initBMService()
            this.bmc.BMDS = this.RDF.GetDataSource("rdf:treanmarks");
            this.bmc.BMSVC = this.bmc.BMDS.QueryInterface(Ci.nsIBookmarksService);
        }

        // replace references to BookmarksMenu in the tmMenu
        // I'm not sure why these hoops are necessary, but attributes' values
        // get all mixed up if I try to access them more directly... I suppose
        // it could be documented behavior, but certainly not very useful
        var attrs_raw = tmMenu.attributes;
        var attrs = new Array(attrs_raw.length);
        for (var i = attrs.length - 1; i >= 0; i--) {
            attrs[i] = attrs_raw[i].name;
        }
        for (var i = attrs.length - 1; i >= 0; i--) {
            var name = attrs[i];
            if (name.indexOf("on") == 0) {
                tmMenu.setAttribute(name, "alert('"+name+"');"+tmMenu.getAttribute(name).replace(
                  'BookmarksMenu', 'g_treanmarks.bmc.BookmarksMenu', 'g'
                ));
            }
        }
*/
    },

    _rebind : function(obj, newScope) {
        // rebind all functions in obj (recursively) to newScope.
        // k is key, v is value, t is typeof value
        for (var k in obj) {
            var v;
            try {
                v = obj[k];
            } catch(e) {
                continue; // some getters will err
            }
            if (!obj.hasOwnProperty(k)) {
                continue;
            }
            var t = typeof v;
            if (t == 'object') {
                this._rebind(v, obj);
            } else if (t == 'function') {                    
                dump("rebinding "+k+"\n");
                obj[k] = bind(v, obj);
            }
        }
        dump("/rebind\n");
    },

    _initPrefs : function() {
        var prefsSvc = Cc["@mozilla.org/preferences-service;1"]. 
                        getService(Ci.nsIPrefService);
        this._prefs = prefsSvc.getBranch("extensions.treanmarks.").
                        QueryInterface(Ci.nsIPrefBranch2);        
        this._prefs.addObserver('', this, false);

        var prefDefs = {
            hordeBase : '',
            bAutoSync : false,
            syncInterval : 5,
            bTrackClicks : false,
            bSkipTopLevel : true,
            bSeparateMenus : false,
            bNoSort : false
        };

        // load default prefs    
        for (var name in prefDefs) {
            var def = prefDefs[name];
            if (!this._prefs.prefHasUserValue(name)) {
                this._prefs['set'+{number:'Int',string:'Char',
                    boolean:'Bool'}[typeof def]+'Pref'](name, def);
            }
        }

    },

    _onShutdown : function() {
    },

    _refreshBookmarksMenu : function() {
        /**
         * Force reload of Bookmarks menu to reflect datasource insertion/
         * removal.
         */
        ['bookmarks-menu', 'treanmarks-menu'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el && el.builder) {
                el.builder.rebuild();
            }
        });
    },

    observe : function(subject, topic, data) {
        if (topic == "nsTreanMarksDS:error") {
            dump("TreanMarksDS:error occured -"+data+"\n");
        } else if (topic != 'nsPref:changed') {
            return;
        }               
    
        dump("treanmarks nsPref:changed\n");
    
        switch (data) {
        // these will usually require refresh to get the menu to update properly
        case 'bSkipTopLevel':
            window.setTimeout(bind(function() {
                this._refreshBookmarksMenu();
            }, this), 3000);
            break;
        case 'hordeBase':
            this._hordeBase = this._prefs.getCharPref('hordeBase');
            if (this._hordeBase.substr(-1,1) == '/') {
                this._hordeBase = this._hordeBase.slice(0,-1); 
            }
            window.setTimeout(bind(function() {
                this._refreshBookmarksMenu();
            }, this), 3000);
            break;
        default:
            break;
        }
    }
});

var g_treanmarks = new TreanMarks();
// not onload, so we can register ASAP before people get handles to
// rdf:bookmarks
g_treanmarks._onInit(); 
addEventListener('unload', function(){g_treanmarks._onShutdown();}, false);
