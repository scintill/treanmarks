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

// Localization
// Thanks a lot to bookmarks.js
function _(aStringKey, aReplaceString, aBundle) {
    if (!this._bundles || !this._bundles[aBundle]) {
        var LOCALESVC = Components.classes['@mozilla.org/intl/nslocaleservice;1']
                                .getService(Components.interfaces.nsILocaleService);
        var BUNDLESVC = Components.classes['@mozilla.org/intl/stringbundle;1']
                                .getService(Components.interfaces.nsIStringBundleService);
        var bundlePath  = aBundle || 'chrome://treanmarks/locale/treanmarks.properties';
        if (!this._bundles)
            this._bundles = {};
        this._bundles[aBundle]         = BUNDLESVC.createBundle(bundlePath, LOCALESVC.getApplicationLocale());
    }

    var bundle = this._bundles[aBundle];   
    var str;
    try {
        if (!aReplaceString)
            str = bundle.GetStringFromName(aStringKey);
        else if (typeof(aReplaceString) == 'string')
            str = bundle.formatStringFromName(aStringKey, [aReplaceString], 1);
        else
            str = bundle.formatStringFromName(aStringKey, aReplaceString, aReplaceString.length);
    } catch (e) {
        dump("Localization needed for "+aStringKey);
        str = "!!\""+aStringKey+"\"!!";
    }
    
    return str;
}

function _hookFunction(ob, name, hookFunc) {
    ob[name] = (function(fnSuper) {
        return function() {
            var args = new Array(arguments.length+1);
            var i = arguments.length;
            args[i] = fnSuper;
            for (i--; i >= 0; i--) {
                args[i] = arguments[i];
            }
            return hookFunc.apply(null, args);
        };
    })(ob[name]);
}
