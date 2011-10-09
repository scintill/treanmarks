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
 * This is an in-memory RDF datasource.  It gets aggregated with the
 * rdf:bookmarks built-in datasource to present all of the user's bookmarks.
 */

// private stuff
// handle to the RDF service and such
var RDF, RDFC;
// following nsBookmarksService and naming the in-memory RDF datasource as:
var mInner;
// root RDF container
var rootContainer;
// timer for syncing
var syncTimer;

// prefs branch
var prefs;
// cached prefs
var hordeBase;
var bNoSort;
var bTrackClicks;
var syncInterval;
var bAutoSync;

// interface-required stuff follows

// for nsIRDFRemoteDataSource
var loaded = false;

function Init(URI) {
    dump("nsTreanMarksDS Init "+URI+"\n");

    if (this.loaded)
        return;

    this.loaded = true;

    // pull in globals
    JsonRpc = this.JsonRpc;

    // get handle to RDF and RDF container utils
    this.RDF = Cc["@mozilla.org/rdf/rdf-service;1"]
               .getService(Ci.nsIRDFService);
    this.RDFC = Cc["@mozilla.org/rdf/container-utils;1"]
               .getService(Ci.nsIRDFContainerUtils);
    this._rdf_import_properties(this.RDF);

    // open prefs branch
    this.prefs = Cc['@mozilla.org/preferences-service;1'].
                        getService(Ci.nsIPrefService).
                        getBranch('extensions.treanmarks.').
                        QueryInterface(Ci.nsIPrefBranch2);
    this.prefs.addObserver('', this, false);

    // create timer for syncing
    this.syncTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);

    // load some prefs
    this.hordeBase = this.prefs.getCharPref('hordeBase');
    if (this.hordeBase.substr(-1,1) == '/') {
        this.hordeBase = this.hordeBase.slice(0,-1);
    }
    this.bTrackClicks = this.prefs.getBoolPref('bTrackClicks');
    this.bNoSort = this.prefs.getBoolPref('bNoSort');
    this.syncInterval = this.prefs.getIntPref('syncInterval') * 60 * 1000;
    this.bAutoSync = this.prefs.getBoolPref('bAutoSync');

    // get path to XML file to load from, and seed it if necesssary
    var treanmarksXmlFile =
      Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    treanmarksXmlFile.initWithPath(
      Cc["@mozilla.org/file/directory_service;1"]
        .getService(Ci.nsIProperties)
        .get("ProfD", Components.interfaces.nsIFile).path);
    treanmarksXmlFile.append("treanmarks.xml");
    if (!treanmarksXmlFile.exists() || treanmarksXmlFile.fileSize == 0) {
        this._seedXmlFile(treanmarksXmlFile);
    }

    // translate to file:// URL
    var ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);
    var fileHandler = ios.getProtocolHandler("file")
                        .QueryInterface(Ci.nsIFileProtocolHandler);
    var URL = fileHandler.getURLSpecFromFile(treanmarksXmlFile);

    // load inner datasource
    this.mInner = this.RDF.GetDataSourceBlocking(URL);
    // forward generic datasource functions
    this._forward("this.mInner", "nsTreanMarksDS::nsIRDFDataSource");

    // expose remote functions, like Flush()
    this.mInner.QueryInterface(Ci.nsIRDFRemoteDataSource);

    this._loadDatasource();
}

function _loadDatasource(bErase) {
    var bReload;

    bReload = this._initDatasource(bErase);

    // begin loading
    JsonRpc.Request.setDefaultServerUrl(this.hordeBase+"/rpc.php");
    if (bReload) {
        // straight load
        new JsonRpc.Request(
            'bookmarks.getFolders',
            [-1],
            bind(
              function(r,s){this._getFoldersCallback(r,s,this.rootContainer,
                this.prefs.getBoolPref('bSkipTopLevel'));},
              this)
        );
    } else {
        // sync
        this._syncFolder(this.rootContainer);
    }

    // set timeout for next sync
    this.syncTimer.cancel();
    if (this.bAutoSync) {
        this.syncTimer.init(this, this.syncInterval,
          Ci.nsITimer.TYPE_REPEATING_SLACK);
    }
}

function _initDatasource(bErase) {
    // initialize sync cache - always
    this.addObjects = [];
    this.updateObjects = {};
    this.deleteFolders = [];
    this.deleteBookmarks = [];
    this.formerParents = {};

    // check if we should erase
    if (!bErase) {
        if (this.mInner.hasArcOut(this.kTrean_Root, this.kTrean_obID)) {
            this.rootContainer = this.RDFC.MakeSeq(this.mInner, this.kTrean_Root);
            // false return indicates the datasource has not been cleaned
            return false;
        }
    }

    // clear out old data. Iterate all resources, and all their arcs,
    // Unasserting all their targets
    var sources = this.mInner.GetAllResources();
    while (sources.hasMoreElements()) {
        var source = sources.getNext().QueryInterface(Ci.nsIRDFResource);
        this._unassertResource(source);
    }

    // Name and anchor the root
    this.rootContainer = this.RDFC.MakeSeq(this.mInner, this.kTrean_Root);
    this.RDFC.MakeSeq(this.mInner, this.kNC_BookmarksRoot).
      AppendElement(this.kTrean_Root);

    this.mInner.Assert(this.kTrean_Root, this.kRDF_type, this.kNC_Folder, true);
    this.mInner.Assert(this.kTrean_Root, this.kTrean_obID,
      this.RDF.GetIntLiteral(-1), true);
    this.mInner.Assert(this.kTrean_Root, this.kNC_Name,
      this.RDF.GetLiteral("Trean Bookmarks"), true);

    return true;
}

function _unassertResource(source, bUnassertChildren) {
    var arcs = this.mInner.ArcLabelsOut(source);
    while (arcs.hasMoreElements()) {
        var arc = arcs.getNext().QueryInterface(Ci.nsIRDFResource);
        var targets = this.mInner.GetTargets(source, arc, true);
        while (targets.hasMoreElements()) {
            var node = targets.getNext().QueryInterface(Ci.nsIRDFNode);
            this.mInner.Unassert(source, arc, node);
            if (bUnassertChildren && this.RDFC.IsOrdinalProperty(arc)) {
                this._unassertResource(
                  node.QueryInterface(Ci.nsIRDFResource), true);
            } // if
        } // while
    } // while
}

function _syncFolder(container) {
    dump("_syncFolder "+container.Resource.Value+"\n");
    // iterate container's children to assemble bookmarks and folders that
    // need to be synced
    var bookmarks = [];
    var folders = [];
    var folder_containers = [];

    var e = container.GetElements();
    while (e.hasMoreElements()) {
        var child = e.getNext().QueryInterface(Ci.nsIRDFResource);
        var id = this.mInner.GetTarget(child, this.kTrean_obID, true)
                   .QueryInterface(Ci.nsIRDFInt).Value;
        if (this._isFolder(child)) {
            folders.push(id);
            folder_containers.push(this.RDFC.MakeSeq(this.mInner, child));
            // don't recurse now so that the higher-level stuff can load                    // quickest, since it's more likely to be wanted now
        } else {
            bookmarks.push(id);
        }
    }

    // JSON-RPC requests
    var my_id = this.mInner.GetTarget(container.Resource, this.kTrean_obID,
      true).QueryInterface(Ci.nsIRDFInt).Value;
    new JsonRpc.Request(
        'bookmarks.syncBookmarks',
        [my_id, bookmarks],
        bind(function(r,s){this._listBookmarksCallback(r,s,container, true);}, this)
    );
    new JsonRpc.Request(
        'bookmarks.syncFolders',
        [my_id, folders],
        bind(function(r,s){this._getFoldersCallback(r,s,container, false, true);}, this)
    );

    // now recurse to child folders
    for (var i = folder_containers.length - 1; i >= 0; i--) {
        this._syncFolder(folder_containers[i]);
    }
}

function _getFoldersCallback(resp, rpcStatus, container, bSkipLevel, bIsSync) {
    var folders = resp.result;

    /*dump("getFoldersCallback "+
      this.mInner.GetTarget(container.Resource, this.kNC_Name, true)
      .QueryInterface(Ci.nsIRDFLiteral).Value+"\n");*/

    // reverse because grouping folders at top causes them to reverse
    folders.reverse().forEach(bind(function(fol) {
        if (fol.sync_deleted) {
            var resource = this.mInner.GetSource(this.kTrean_obID,
              this.RDF.GetIntLiteral(fol.id), true);
            this._unassertResource(resource, true);
            container.RemoveElement(resource, false);
            return;
        }

        // note return above!

        // if this is the root (the top level is only "Joey's Bookmarks" or
        // whatever), skip to next level according to user prefs
        var folSeq = bSkipLevel ? container :
                     this._makeFolder(fol, container, bIsSync);

        // make sure the ID is correct
        if (bSkipLevel) {
            this.mInner.Unassert(container.Resource, this.kTrean_obID,
              this.RDF.GetIntLiteral(-1), true);
            this.mInner.Assert(container.Resource, this.kTrean_obID,
              this.RDF.GetIntLiteral(fol.id), true);
        }

        // load children
        new JsonRpc.Request(
            'bookmarks.getFolders',
            [fol.id],
            bind(function(r,s){this._getFoldersCallback(r,s,folSeq);}, this)
        );
        new JsonRpc.Request(
            'bookmarks.listBookmarks',
            [fol.id, '', 0, 0, 0],
            bind(function(r,s){this._listBookmarksCallback(r,s,folSeq);}, this)
        );
    }, this));
}

function _listBookmarksCallback(resp, rpcStatus, container, bIsSync) {
    var bookmarks = resp.result;
    var length = bookmarks.length;

    for (var i = 0; i < bookmarks.length; i++) {
        var bm = bookmarks[i];
        if (bm.sync_deleted) {
            var resource = this.mInner.GetSource(this.kTrean_obID,
              this.RDF.GetIntLiteral(bm.id), true);
            this._unassertResource(resource);
            container.RemoveElement(resource, false);
        } else {
            this._makeBookmark(bm, container, bIsSync);
        }
    }

    this._flushIfLoaded();
}

function _makeFolder(fol, container, bSort) {
    var folder = this.RDF.GetAnonymousResource();
    this.mInner.Assert(folder, this.kTrean_obID,
        this.RDF.GetIntLiteral(fol.id), true);
    var folSeq = this.RDFC.MakeSeq(this.mInner, folder);
    this.mInner.Assert(folder,
        this.kNC_Name, this.RDF.GetLiteral(fol.name), true);

    if (!bSort || this.bNoSort) {
        container.InsertElementAt(folder, 1, true);
    } else {
        this._sortMeInto(folder, container);
    }

    return folSeq;
}

function _makeBookmark(bm, container, bSort) {
    var bookmark = this.RDF.GetAnonymousResource();
    this.mInner.Assert(bookmark,
        this.kTrean_obID, this.RDF.GetIntLiteral(bm.id), true);
    this.mInner.Assert(bookmark,
        this.kNC_Name, this.RDF.GetLiteral(bm.title), true);
    this.mInner.Assert(bookmark,
        this.kNC_URL, this.RDF.GetLiteral(bm.url), true);
    this.mInner.Assert(bookmark,
        this.kDevMo_ForwardProxy, this.RDF.GetResource(bm.url), true);
    if (bm.description && bm.description.length) {
        this.mInner.Assert(bookmark,
            this.kNC_Description, this.RDF.GetLiteral(bm.description), true);
    }

    if (!bSort || this.bNoSort) {
        container.AppendElement(bookmark);
    } else {
        this._sortMeInto(bookmark, container);
    }

    return bookmark;
}

var collation = Cc["@mozilla.org/intl/collation-factory;1"]
                  .getService(Ci.nsICollationFactory)
                  .CreateCollation(
                    Cc["@mozilla.org/intl/nslocaleservice;1"]
                    .getService(Ci.nsILocaleService)
                    .getApplicationLocale()
                  );
function _sortMeInto(resource, container) {
    // source of BookmarksCommand.realSortByName() helps a lot.
    // we'll do an insertion sort, though, which is different than that
    var bIsFolder = this._isFolder(resource);
    var name = this.mInner.GetTarget(resource, this.kNC_Name, true)
                 .QueryInterface(Ci.nsIRDFLiteral).Value;

    var e = container.GetElements();
    var sibRes = null;
    while (e.hasMoreElements()) {
        sibRes = e.getNext().QueryInterface(Ci.nsIRDFResource);
        var bSibIsFolder = this._isFolder(sibRes);
        var sibName = this.mInner.GetTarget(sibRes, this.kNC_Name, true)
                        .QueryInterface(Ci.nsIRDFLiteral).Value;

        /*
         * Bookmarks are always "greater" than folders - but stop before
         * crossing the "line"
         */
        if (bSibIsFolder && !bIsFolder) {
            continue;
        } else if (bIsFolder && !bSibIsFolder) {
            break;
        }

        // if my value is less than the sibling's, break
        if (this.collation.compareString(0, name, sibName) < 0) {
            break;
        }
    }

    var index = sibRes ? container.IndexOf(sibRes) : 0;
    container.InsertElementAt(resource, index, true);
}

function _getParent(source) {
    // Copying nsBookmarksService code: iterate ArcsIn to find an ordinal.
    var arcs = this.mInner.ArcLabelsIn(source);
    while (arcs.hasMoreElements()) {
        var prop = arcs.getNext().QueryInterface(Ci.nsIRDFResource);
        if (this.RDFC.IsOrdinalProperty(prop)) {
            return this.mInner.GetSource(prop, source, true);
        }
    }

    return null;
}

function _isFolder(source) {
    return this.RDFC.IsSeq(this.mInner, source);
}

function _translateObject(source, forceNoParent) {
    var struct = {
        return_key : source.Value
    };
    var folder_id = this.mInner.GetTarget(this._getParent(source),
        this.kTrean_obID, true);

    if (folder_id) {
        struct.folder_id = folder_id.QueryInterface(Ci.nsIRDFInt).Value;
    } else if (!forceNoParent) {
        // when recursively called, this is set. otherwise, we return null
        // and the top-level code ignores this
        return null; 
    }

    var name = this.mInner.GetTarget(source, this.kNC_Name, true)
      .QueryInterface(Ci.nsIRDFLiteral).Value;

    if (this._isFolder(source)) {
        struct.name = name;
        // iterate any children and package them up with me - this can happen
        // if someone drags/copies a folder from local Bookmarks to Trean
        var seq = this.RDFC.MakeSeq(this.mInner, source);
        var e = seq.GetElements();
        var child_objects = [];
        while (e.hasMoreElements()) {
            var child = e.getNext().QueryInterface(Ci.nsIRDFResource);
            if (!this.mInner.hasArcOut(child, this.kTrean_obID)) {
                child_objects.push(this._translateObject(child, true));
            }
        }
        if (child_objects.length) {
            struct.child_objects = child_objects;
        }
    } else {
        struct.bookmark_title = name;
        var node = this.mInner.GetTarget(source, this.kNC_URL, true)
        if (node) {
            struct.bookmark_url = node.QueryInterface(Ci.nsIRDFLiteral).Value;
            // bookmarks need a URL, or they fail to create
            if (!struct.bookmark_url.length) {
                struct.bookmark_url = "about:blank";
            }
        }
        node = this.mInner.GetTarget(source, this.kNC_Description, true);
        if (node) {
            struct.bookmark_description = node
              .QueryInterface(Ci.nsIRDFLiteral).Value;
        }
    }

    dump("struct "+source.Value+"\n");
    for (var k in struct) {
        if (struct.hasOwnProperty(k))
            dump("    "+k+" = "+struct[k]+"\n");
    }

    dump(Object.toJSON(struct)+"\n");
    return struct;
}

function _translateUpdates(sourceStr, asserts) {
    var source = this.RDF.GetResource(sourceStr);
    var struct = {};
    var id = this.mInner.GetTarget(source, this.kTrean_obID, true);
    var field;

    if (id) {
        id = id.QueryInterface(Ci.nsIRDFInt).Value;
    } else {
        return null; // RPC to get an ID must not have returned yet; requeue
    }

    if (this._isFolder(source)) {
        struct.folder_id = id;
        for (var prop in asserts) {
            if (!asserts.hasOwnProperty(prop)) {
                continue;
            }
            switch (prop) {
            case 'Name':
                field = 'name';
                break;
            // pass-thru to Trean
            case 'folder':
                field = prop;
                break;
            default:
                dump("Trean doesn't support changing the "+prop+" of a folder.\n");
                field = null;
                break;
            } // switch
            if (field) {
                struct[field] = asserts[prop];
            } // if
        } // for
    } else {
        struct.bookmark_id = id;
        for (var prop in asserts) {
            if (!asserts.hasOwnProperty(prop)) {
                continue;
            }

            switch (prop) {
            case 'Name':
                field = 'title';
                break;
            case 'URL':
                field = 'url';
                break;
            case 'Description':
                field = 'description';
                break;
            // pass-thru to Trean
            case 'folder':
                field = prop;
                break;
            default:
                dump("Trean doesn't support changing the "+prop+" of a bookmark.\n");
                field = null;
                break;
            } // switch
            if (field) {
                struct[field] = asserts[prop];
            } // if
        } // for
    } // if

    return struct;
}

function _addObjectsCallback(resp) {
    // just need to Assert in our new IDs so things can be manipulated later.
    // resp has an object mapping resource strings to the IDs
    var ids = resp.result;

    if (resp.error) {
        // XXX report the error somehow?
        return;
    }

    for (var resStr in ids) {
        if (!ids.hasOwnProperty(resStr)) {
            continue;
        }
        var res = this.RDF.GetResource(resStr);
        if (!this.mInner.hasArcOut(res, this.kTrean_obID)) {
            this.mInner.Assert(res, this.kTrean_obID,
              this.RDF.GetIntLiteral(ids[resStr]), true);
            dump(resStr+".id="+ids[resStr]+"\n");
        }
    }

    this._flushIfLoaded();
}

function Flush() {
    dump("nsTreanMarksDS Flush\n");

    // drop this cache of orphaned resources
    this.formerParents = {};

    if (this.deleteFolders.length) {
        dump("deleteFolders "+this.deleteFolders.length+"\n");
        // no translation required.
        /*
         * Hackalicious way to try to get child folders deleted before their
         * parents, so the parent can get deleted.  Of course, it's assuming
         * the child was deleted first in Firefox
         */
        this.deleteFolders.reverse(); 

        new JsonRpc.Request(
            'bookmarks.deleteFolders',
            [this.deleteFolders],
            null
        );
        this.deleteFolders = [];
    }

    if (this.deleteBookmarks.length) {
        dump("deleteBookmarks "+this.deleteBookmarks.length+"\n");
        // no translation required
        new JsonRpc.Request(
            'bookmarks.deleteBookmarks',
            [this.deleteBookmarks],
            null
        );
        this.deleteBookmarks = [];
    }

    if (this.addObjects.length) {
        dump("addObjects "+this.addObjects.length+"\n");
        var structs = [];
        for (var i = this.addObjects.length - 1; i >= 0; i--) {
            var struct = this._translateObject(this.addObjects[i]);
            if (struct) {
                structs.push(struct);
            }
        }
        new JsonRpc.Request(
            'bookmarks.addObjects',
            [structs],
            bind(function(resp) {
                this._addObjectsCallback(resp);
            }, this)
        );

        this.addObjects = [];
    }

    // this.updateObjects = { res1 : { prop1 : value1, prop2 : ... } }
    // Properties are strings, clipped at #. The values (targets) are raw
    // RDF objects.
    var updateObs = [];
    for (var k in this.updateObjects) {   
        if (this.updateObjects.hasOwnProperty(k)) {
            var ob = this._translateUpdates(k, this.updateObjects[k]);        
            if (ob) {
                updateObs.push(ob);
                delete this.updateObjects[k];
            }
        }
    }

    if (updateObs.length) {
        dump("updateObs "+updateObs.length+"\n");
        new JsonRpc.Request(
            'bookmarks.updateObjects',
            [updateObs],
            null
        );
    }

    // Flush XML
    this.mInner.Flush();

    dump("/nsTreanMarksDS Flush\n");
}

function _flushIfLoaded() {
    // If few Ajax requests are waiting, we're "loaded" and should flush now.
    // Trying to balance: cache to disk often, but not whenever things change.
    if (this.Ajax.activeRequestCount <= 2) {
        this.mInner.Flush();
    }
}

function FlushTo(URI) {
    dump("nsTreanMarksDS FlushTo "+URI+"\n");
    Components.returnCode = Components.results.NS_ERROR_NOT_IMPLEMENTED;
    return;
}

function Refresh(blocking) {
    dump("nsTreanMarksDS Refresh "+blocking+"\n");
    Components.returnCode = Components.results.NS_ERROR_NOT_IMPLEMENTED;
    return;
}

function _seedXmlFile(treanmarksXmlFile) {
    // need to seed the XML file with an empty RDF container so that it'll load
    var xml = '<?xml version="1.0"?> <RDF:RDF xmlns:Trean="http://trean.horde.org/rdfns/0.1#" xmlns:DevMo="http://developer.mozilla.org/rdf/vocabulary/forward-proxy#" xmlns:WEB="http://home.netscape.com/WEB-rdf#" xmlns:NC="http://home.netscape.com/NC-rdf#" xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#"> </RDF:RDF>';

    // IO flags from prio.h <http://lxr.mozilla.org/mozilla1.8.0/source/nsprpub/pr/include/prio.h>
    var PR_WRONLY       = 0x02;
    var PR_CREATE_FILE  = 0x08;
    var PR_TRUNCATE     = 0x20;

    var outputStream = Cc["@mozilla.org/network/file-output-stream;1"]
                         .createInstance(Ci.nsIFileOutputStream);
    outputStream.init(treanmarksXmlFile,
      PR_WRONLY | PR_CREATE_FILE | PR_TRUNCATE, 0600, 0);
    outputStream.write(xml, xml.length);
    outputStream.close();
}

// for nsIObserver (prefs branch)
function observe(subject, topic, data) {
    dump("observe() "+topic+"\n");
    if (topic == 'nsPref:changed') {
        dump("nsPref:changed "+data+"\n");

        switch (data) {
        case 'hordeBase':
            this.hordeBase = this.prefs.getCharPref('hordeBase');
            if (this.hordeBase.substr(-1,1) == '/')
                this.hordeBase = this.hordeBase.slice(0,-1);        
            this._loadDatasource(true);
            break;
        case 'syncInterval':
        case 'bAutoSync':
            this.syncInterval = this.prefs.getIntPref('syncInterval') * 60 * 1000;
            this.bAutoSync = this.prefs.getBoolPref('bAutoSync');
            this.syncTimer.cancel();
            if (this.bAutoSync) {
                dump("resetting timer\n");
                this.syncTimer.init(this, this.syncInterval,
                  Ci.nsITimer.TYPE_REPEATING_SLACK);
            }
            break;
        case 'bSkipTopLevel':
            this._loadDatasource(true);
            break;
        // fall-thru for simple boolean prefs we want to cache
        case 'bTrackClicks':
        case 'bNoSort':
            this[data] = this.prefs.getBoolPref(data);
            break;
        default:
            break;
        }
    } else if (topic == 'timer-callback') {
        dump("timer fired\n");
        this._syncFolder(this.rootContainer);
    }
}

// for nsIRDFDataSource
var URI = "rdf:treanmarks";

function GetTarget(source, property, truthValue) {
    var ret = this.mInner.GetTarget(source, property, truthValue);
    if (!ret && truthValue) {
        if (property == this.kRDF_type) {
            ret = this.RDFC.IsSeq(this.mInner, source) ?
              this.kNC_Folder : this.kNC_Bookmark;
        }
    }

    return ret;
}

function _recordUpdate(source, property, target) {
    var shortProp = property.Value.split('#')[1];
    var obKey, value;

    // some RDF properties don't need to be recorded with Trean
    switch (shortProp) {
    case 'ID':
    case 'obID': // Trean:obID
    case 'nextVal':
    case 'forward-proxy':
        return;
    default:
    }

    // OK, this *does* need to go to Trean

    if (this.RDFC.IsOrdinalProperty(property)) {
        // changing parent of 'target' to 'source'
        obKey = target;
        shortProp = 'folder';
        value = this.mInner.GetTarget(source, this.kTrean_obID, true)
                           .QueryInterface(Ci.nsIRDFInt).Value;
    } else {
        obKey = source;
        try {
            value = target.QueryInterface(Ci.nsIRDFLiteral).Value;
        } catch(e) {
            dump("error QI'ing "+shortProp+"\n");
        }
    }

    // Add to updates object
    var myOb = this.updateObjects[obKey.Value];
    if (!myOb) {
        myOb = this.updateObjects[obKey.Value] = {};
    }
    myOb[shortProp] = value;

    dump("_recordUpdate myOb["+shortProp+"] = "+value+"\n");
}

function Assert(source, property, target, truthValue) {
    dump("    nsTreanMarksDS Assert "+source.Value+" "+property.Value+" "+target.Value+"\n");

    /*
     * Reordering of bookmarks can cause tons of (Un)Asserts for ordinal
     * properties.
     * Pay attention to those and don't pass them to _recordUpdate()
     * (don't waste RPC bandwidth when someone's reordering 100 bookmarks!)
     * source is the new parent, which may be equal to former RDF parent
     * (resources are temporarily orphaned.)  We track it in Unassert()
     */
    var noUpdate = false;
    if (this.RDFC.IsOrdinalProperty(property)) {
        var formerParent = this.formerParents[target.Value];
        if (formerParent) {
            delete this.formerParents[target.Value];
            dump("is ordinal, parent="+formerParent.Value+"\n");
            if (source == formerParent) {
                noUpdate = true;
            }
        } else if (this.addObjects.indexOf(target) != -1) {
            // this necessary because sometimes we'll try to record updates
            // on objects that don't have Trean IDs yet!       
            noUpdate = true;
        }
    }
   
    this.mInner.Assert(source, property, target, truthValue);

    /*
     * We need to track changes here to sync them to the server.
     * Either new objects are being created (there is no kTrean_obID property),
     * or objects are being changed.  They need to be tracked separately.
     * Sync on Flush().
     */
    if (this.mInner.GetTarget(source, this.kTrean_obID, true) == null) {
        // New bookmark
        if (this.addObjects.indexOf(source) != -1) {
            return; // nothing more to do here; it's already recorded
        }
        dump("++addObjects "+source.Value+"\n");
        this.addObjects.push(source);
    } else if (!noUpdate) {
        // Changing a bookmark
        this._recordUpdate(source, property, target);
    }
}

function Change(source, property, oldValue, newValue) {
    // Only bother if we have the original assertion - simple way to ignore
    // things that are in Bookmarks DS, not us
    if (!this.mInner.HasAssertion(source, property, oldValue, true)) {
        return;
    }
    
    dump("    nsTreanMarksDS Change "+source.Value+" "+property.Value+" "+oldValue.Value+" "+newValue.Value+"\n");

    this.mInner.Change(source, property, oldValue, newValue);
    var rv = Components.lastResult;

    this._recordUpdate(source, property, newValue);    

    Components.returnCode = rv;
    return;
}

function Unassert(source, property, target) {
    dump("    nsTreanMarksDS Unassert "+source.Value+" "+property.Value+" "+target.Value+"\n");

    // Unassertion of Name means the bookmark is being deleted.  Clean up
    // Trean ID.
    if (property == this.kNC_Name) {
        var id = this.mInner.GetTarget(source, this.kTrean_obID, true);
        if (id) { // perhaps ID already got Unasserted
            var idInt = id.QueryInterface(Ci.nsIRDFInt).Value;
            if (this._isFolder(source)) {
                this.deleteFolders.push(idInt);
            } else {
                this.deleteBookmarks.push(idInt);
            }
            this.mInner.Unassert(source, this.kTrean_obID, id);
        }
    } else if (this.RDFC.IsOrdinalProperty(property)) {
        target.QueryInterface(Ci.nsIRDFResource);
        // Track it so if it gets re-Asserted to same parent, we don't sync
        this.formerParents[target.Value] = source;
    }

    this.mInner.Unassert(source, property, target);
    Components.returnCode = Components.lastResult;
}

function DoCommand(sources, command, arguments) {
    dump("nsTreanMarksDS::DoCommand "+sources+" "+command+" "+arguments+"\n");

    // I invented a command that is fired when a bookmark is opened. Track
    // clicks here.

    var treanID = this.mInner.GetTarget(sources.GetElementAt(0),
      this.kTrean_obID, true);

    // bail out if this click shouldn't be tracked
    if (!this.bTrackClicks || !treanID || command != this.kNC_CmdOpenBookmark) {
        Components.returnCode = Components.results.NS_ERROR_NOT_IMPLEMENTED;
        return;
    }

    dump("sending request\n");

    // this URL actually redirects to the site, but we'll ignore that
    new Ajax.Request(
        this.hordeBase+"/trean/redirect.php?b="+
          treanID.QueryInterface(Ci.nsIRDFInt).Value,
        { method: 'get' }
    );
}

// for nsIBookmarksService

// for nsISupports
function QueryInterface(aIID) {
    try {
        interface = Components.interfacesByID[aIID].name;
    } catch (e) {
        interface = aIID;
    }
    //dump("nsTreanMarksDS QI "+interface+"\n");

    if (aIID.equals(Ci.nsISupports))
        return this;

    var ifaces = this.getInterfaces({});
    for (var i = ifaces.length - 1; i >= 0; i--) {
        if (ifaces[i].equals(aIID))
            return this;
    }

    //dump("nsTreanMarksDS     NO_INTERFACE!\n");

    throw Cr.NS_ERROR_NO_INTERFACE;
}

// for nsIClassInfo
var classDescription = CLASS_NAME;
var classID = CLASS_ID;
var classIDNoAlloc = CLASS_ID;
var contractID = CONTRACT_ID;
var flags = Ci.nsIClassInfo.SINGLETON;
var implementationLanguage = Ci.nsIProgrammingLanguage.JAVASCRIPT;

function getHelperForLanguage(language) {
    return null;
}

function getInterfaces(count) {
    var ret = [
        Ci.nsIRDFDataSource,
        Ci.nsIRDFRemoteDataSource,
        Ci.nsIBookmarksService,

        Ci.nsIClassInfo,
        Ci.nsIObserver
    ];
    count.value = ret.length;
    return ret;
}
// end nsIClassInfo
