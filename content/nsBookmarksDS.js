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
 * of the browser QueryInterface() the DS into the Bookmarks Service, we
 * must allow the same.
 */

// private stuff
// handle to the RDF service
var RDF;
// the composite datasource
var mInner;

// interface-required stuff follows

// for nsIRDFRemoteDataSource
var loaded = false;

function Init(URI) {
    dump("nsBookmarksDS Init "+URI+"\n");

    if (this.loaded)
        return;

    this.loaded = true;

    // localization
    this.BMProps = 'chrome://browser/locale/bookmarks/bookmarks.properties';

    // open prefs branch
    this.prefs = Cc['@mozilla.org/preferences-service;1'].
                        getService(Ci.nsIPrefService).
                        getBranch('extensions.treanmarks.').
                        QueryInterface(Ci.nsIPrefBranch2);
    //this.prefs.addObserver('', this, false);

    // RDF objects we need
    this.RDF = Cc["@mozilla.org/rdf/rdf-service;1"]
               .getService(Ci.nsIRDFService);
    this.RDFC = Cc["@mozilla.org/rdf/container-utils;1"]
               .getService(Ci.nsIRDFContainerUtils);
    this._rdf_import_properties(this.RDF);

    // create inner composite datasource and forward its functions
    this.mInner = Cc["@mozilla.org/rdf/datasource;1?name=composite-datasource"]
             .createInstance(Ci.nsIRDFDataSource);
    this._forward('this.mInner', "nsBookmarksDS::nsIRDFDataSource");

    // optimize the composite DS
    this.mInner.QueryInterface(Ci.nsIRDFCompositeDataSource);
    this.mInner.allowNegativeAssertions = false;
    this.mInner.coalesceDuplicateArcs = false;

    // add rdf:bookmarks to the inner datasource
    this.rdfBookmarks = Cc["@mozilla.org/browser/bookmarks-service;1"]
                       .getService(Ci.nsIRDFDataSource);
    this.rdfBookmarks.QueryInterface(Ci.nsIRDFRemoteDataSource);
    this.mInner.AddDataSource(this.rdfBookmarks);

    // rdf:treanmarks
    if (!this.prefs.getBoolPref('bSeparateMenus')) {
        this.rdfTreanmarks = this.RDF.GetDataSource("rdf:treanmarks");
        this.rdfTreanmarks.QueryInterface(Ci.nsIRDFRemoteDataSource);
        this._shift_root(true);
        this.mInner.AddDataSource(this.rdfTreanmarks);
    }

    // forward all the nsIBookmarksService functions
    this.rdfBookmarks.QueryInterface(Ci.nsIBookmarksService);
    this._forward("this.rdfBookmarks", "nsBookmarksDS::nsIBookmarksService");

    // register this datasource, overriding rdf:bookmarks
    this.RDF.RegisterDataSource(this, true);
}

function _callOnAllSources(iface, func, args) {
    for (var enum = this.mInner.GetDataSources(); enum.hasMoreElements(); ) {
        try {
            var obj = enum.getNext().QueryInterface(iface);
            if (obj) {
                dump("URI="+obj.URI+"\n");
                obj[func].apply(obj, args);
            }
        } catch(e) {
            dump(e);
        }
    }
}

function _shift_root(bIncludeTreanmarks) {
    // move all children of NC:BookmarksRoot to either make room for
    // the "Trean Bookmarks" folder, or take the space it used to occupy.
    var container = this.RDFC.MakeSeq(this.rdfBookmarks,
      this.kNC_BookmarksRoot);
    var ordinal1 = this.RDFC.IndexToOrdinalResource(1);
    if (bIncludeTreanmarks) {
        // if it has a first element, bump it. if not, bump the nextVal
        // so nobody else is first
        if (this.rdfBookmarks.hasArcOut(this.kNC_BookmarksRoot, ordinal1)) {
            dump("renumbering (down)\n");
            var dummy = this.RDF.GetAnonymousResource();
            container.InsertElementAt(dummy, 1, true);
            container.RemoveElementAt(1, false);
        } else {
            dump("bumping nextVal to 2\n");
            var target = this.rdfBookmarks.GetTarget(this.kNC_BookmarksRoot,
              this.kRDF_nextVal, true);
            this.rdfBookmarks.Unassert(this.kNC_BookmarksRoot,
              this.kRDF_nextVal, target);
            this.rdfBookmarks.Assert(this.kNC_BookmarksRoot,
              this.kRDF_nextVal, this.RDF.GetIntLiteral(2), true);
        }
    } else {
        // shift the other way
        if (!this.rdfBookmarks.hasArcOut(this.kNC_BookmarksRoot, ordinal1)) {
            dump("renumbering (up)\n");
            var dummy = this.RDF.GetAnonymousResource();
            this.rdfBookmarks.Assert(this.kNC_BookmarksRoot, ordinal1,
              dummy, true);
            container.RemoveElementAt(1, true);
        }
    }
    dump("done shifting\n");
}

function Flush() {
    dump("nsBookmarksDS Flush\n");
    this.rdfBookmarks.Flush();
    this.rdfTreanmarks.Flush();
}

function FlushTo(URI) {
    dump("nsBookmarksDS FlushTo "+URI+"\n");
    this._callOnAllSources(Ci.nsIRDFRemoteDataSource, "FlushTo", arguments);
}

function Refresh(blocking) {
    dump("nsBookmarksDS Refresh "+blocking+"\n");
    this._callOnAllSources(Ci.nsIRDFRemoteDataSource, "Refresh", arguments);
}

// for nsIRDFDataSource
function Assert(source, property, target, truthValue) {
    dump("nsBookmarksDS Assert "+source.Value+" "+property.Value+" "+target.Value+"\n");
    var NS_RDF_ASSERTION_REJECTED = 0x4F0003;

    /*
     * If we're linking 'target' to a parent folder, we'll finally know what
     * kind of bookmark it is.  This happens last, so we'll flush everything
     * about that bookmark.
     */

    // note early return above
    // down here is only stuff related to Ordinal properties

    /*
     * But only do this special behavior when the bookmark is NOT currently
     * in Trean (kTrean_obID check.)
     * We must also take care of moving Trean bookmarks back into the local:
     * i.e., new parent is non-Trean but the bookmark has a kTrean_obID.
     * AND, we need special logic to ignore when the Trean root folder
     * gets RE-linked to the Bookmarks root (i.e., re-ordering the root.)
     * We have a special property on the root folder to detect this.
     */
    var bIsOrdinal, bIAmTrean = false, bParentIsTrean = false;
    bIsOrdinal = this.RDFC.IsOrdinalProperty(property);
    if (bIsOrdinal && this.rdfTreanmarks) {
        bIAmTrean = this.rdfTreanmarks.hasArcOut(target, this.kTrean_obID);
        bParentIsTrean = this.rdfTreanmarks.hasArcOut(source, this.kTrean_obID);
    }

    //dump("bIsOrdinal="+bIsOrdinal+", bIAmTrean="+bIAmTrean+", bParentIsTrean="+bParentIsTrean+"\n");

    if (!bIAmTrean && bParentIsTrean) {
        dump("    bookmark->trean\n");
        /*
         * Move everything out of the bookmarks DS and put it in Trean DS.
         * 'target' is the bookmark we are moving around right now.
         * In order to get the Bookmark DS to allow us to Unassert it, we need
         * a parent. So Assert that, do our business, and Unassert it.
         */
        var rootSeq =
          this.RDFC.MakeSeq(this.rdfBookmarks, this.kNC_BookmarksRoot);
        rootSeq.AppendElement(target);

        this._move_resource(this.rdfBookmarks, target, this.rdfTreanmarks);

        // Clean up assertions we had to make
        rootSeq.RemoveElement(target, false);
        // Finally, pass on the hierarchy linkage
        this.rdfTreanmarks.Assert(source, property, target, truthValue);
    } else if (bIAmTrean && !bParentIsTrean && (this.rdfTreanmarks &&
      !this.rdfTreanmarks.hasArcOut(target, this.kTrean_Root)) ) {
        dump("    trean->bookmark\n");
        /*
         * Similar to above, just reversed, and if possible, more painful. :)
         */
        // We need to create a new bookmark (new resource), and copy into that
        var new_res = this._map_resource(this.rdfTreanmarks, target,
          this.rdfBookmarks);
        // Link to parent as this Assert is trying to do, so we'll be allowed
        // to Assert more
        this.rdfBookmarks.Assert(source, property, new_res, truthValue);
        // Now move everything from old bookmark to this new one
        this._move_resource(this.rdfTreanmarks, target,
          this.rdfBookmarks, new_res);
    } else {
        /*
         * Otherwise, just pass it on.  It will either stick to the bookmarks
         * DS because it's in there, or Trean DS will take it in.
         * I basically re-implement CompositeDS::Assert() here because I want
         * to try with the bookmarks DS first, but arranging them in that order
         * causes a crash in HasAssertion(). :/ Who knows why.
         */
        dump("    pass-thru\n");
        this.rdfBookmarks.Assert(source, property, target, truthValue);
        if (Components.lastResult == NS_RDF_ASSERTION_REJECTED
          && this.rdfTreanmarks) {
            this.rdfTreanmarks.Assert(source, property, target, truthValue);
        }
    }
}

function _move_resource(sourceDS, sourceRes, destDS, destRes) {
    // move all arcs starting at sourceRes, from sourceDS to destDS.
    // if destRes is passed, it's the resource to copy into on destDS

    var arcs = []; // save into array, because we modify while iterating!
    var e = sourceDS.ArcLabelsOut(sourceRes);
    while (e.hasMoreElements()) {
        var arc = e.getNext().QueryInterface(Ci.nsIRDFResource);
        // don't copy Trean ID, no need to
        if (arc == this.kTrean_obID) {
            continue;
        }
        arcs.push(arc);
    }

    destRes = destRes || sourceRes; // default destRes to same as source
    for (var i = arcs.length - 1; i >= 0; i--) {
        var prop = arcs[i];
        var target = sourceDS.GetTarget(sourceRes, prop, true);

        // if this is an ordinal arc, move the child too!
        if (this.RDFC.IsOrdinalProperty(prop)) {
            var childRes = this._map_resource(sourceDS, target, destDS);
            // link now, so we can Assert the rest
            destDS.Assert(destRes, prop, childRes, true);

            this._move_resource(sourceDS, target, destDS, childRes);
        } else {
            // not sure what #ID is used for, but it ought to point to itself
            if (prop == this.kNC_ID) {
                target = destRes;
            }
            var old_target = destDS.GetTarget(destRes, prop, true); 
            if (old_target) {
                destDS.Change(destRes, prop, old_target, target, true);
            } else {
                destDS.Assert(destRes, prop, target, true);
            }
        }

        sourceDS.Unassert(sourceRes, prop, target);
    }
}

function _map_resource(sourceDS, sourceRes, destDS) {
    if (destDS != this.rdfBookmarks) {
        return sourceRes;
    }

    if (this.RDFC.IsSeq(sourceDS, sourceRes)) {
        return this.createFolder("");
    } else {
        return this.createBookmark("", "", "", "", "", "");
    }
}

function Unassert(source, property, target) {
    dump("nsBookmarksDS Unassert "+source.Value+" "+property.Value+" "+target.Value+"\n");

    this.mInner.Unassert(source, property, target);
    Components.returnCode = Components.lastResult;
}

var URI = "rdf:bookmarks";

function GetTarget(aSource, aProperty, aTruth) {
    // The internal bookmarks DS synthesizes the rdf:type attribute.
    // Further, for Trean bookmarks (which it can't see at all!), I think it's
    // returning in such a way that the composite datasource never asks
    // the Trean DS. So we'll have to do it ourselves.
    // (Icons may pose a similar problem, in the future.)
    //dump("GetTarget "+aSource.Value+" "+aProperty.Value+" "+aTruth+"\n");
    var rv = this.mInner.GetTarget(aSource, aProperty, aTruth);
    if (!rv && aTruth && (aProperty == this.kRDF_type) && this.rdfTreanmarks) {
        rv = this.rdfTreanmarks.GetTarget(aSource, aProperty, aTruth);
    }

    return rv;
}

function GetAllResources() {
    // RDFCompositeDataSource doesn't implement this, and the sweet little
    // "RDF Viewer" extension needs it.
    // Let's see if we can stitch together multiple enumerators from
    // the sources we have...

    function nsICompositeEnumerator() {}
    nsICompositeEnumerator.prototype = {
        _enums : null,
        _i : 0,

        hasMoreElements : function() {
            if (this._i >= this._enums.length)
                return false;
            return this._enums[this._i].hasMoreElements();
        },

        getNext : function() {
            var ret = this._enums[this._i].getNext();
            if (!this._enums[this._i].hasMoreElements())
                this._i++;
            return ret;
        }
    };

    var ret = new nsICompositeEnumerator();       
    ret._enums = [];
    for (var enum = this.mInner.GetDataSources(); enum.hasMoreElements(); ) {
        ret._enums.push(enum.getNext().GetAllResources());        
    }

    return ret;
}

// for nsIBookmarksService
var BOOKMARK_DEFAULT_TYPE   = 0;
var BOOKMARK_SEARCH_TYPE    = 1;
var BOOKMARK_FIND_TYPE      = 2;

// for nsIObserver (prefs branch)
/*
 * Not necessary for the moment
function observe(subject, topic, data) {
    if (topic != 'nsPref:changed')
        return;

    dump("nsBookmarksDS nsPref:changed\n");

    switch (data) {
    default:
        break;
    }
}
 */

// for nsISupports
function QueryInterface(aIID) {
    //dump("nsBookmarksDS QI "+Components.interfacesByID[aIID].name+"\n");

    if (aIID.equals(Ci.nsISupports))
        return this;

    var ifaces = this.getInterfaces({});
    for (var i in ifaces) {
        if (ifaces[i].equals(aIID))
            return this;
    }

    //dump("nsBookmarksDS     NO_INTERFACE!\n");

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

        //Ci.nsIObserver,
        Ci.nsIClassInfo
    ];
    count.value = ret.length;
    return ret;
}
// end nsIClassInfo
