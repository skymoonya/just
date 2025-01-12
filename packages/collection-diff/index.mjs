/*
  const obj1 = {a: 4, b: 5};
  const obj2 = {a: 3, b: 5};
  const obj3 = {a: 4, c: 5};

  diff(obj1, obj2);
  [
    { "op": "replace", "path": ['a'], "value": 3 }
  ]

  diff(obj2, obj3);
  [
    { "op": "remove", "path": ['b'] },
    { "op": "replace", "path": ['a'], "value": 4 }
    { "op": "add", "path": ['c'], "value": 5 }
  ]

  // using converter to generate jsPatch standard paths
  // see http://jsonpatch.com
  import {diff, jsonPatchPathConverter} from 'just-diff'
  diff(obj1, obj2, jsonPatchPathConverter);
  [
    { "op": "replace", "path": '/a', "value": 3 }
  ]

  diff(obj2, obj3, jsonPatchPathConverter);
  [
    { "op": "remove", "path": '/b' },
    { "op": "replace", "path": '/a', "value": 4 }
    { "op": "add", "path": '/c', "value": 5 }
  ]

  // arrays
  const obj4 = {a: 4, b: [1, 2, 3]};
  const obj5 = {a: 3, b: [1, 2, 4]};
  const obj6 = {a: 3, b: [1, 2, 4, 5]};

  diff(obj4, obj5);
  [
    { "op": "replace", "path": ['a'], "value": 3 }
    { "op": "replace", "path": ['b', 2], "value": 4 }
  ]

  diff(obj5, obj6);
  [
    { "op": "add", "path": ['b', 3], "value": 5 }
  ]

  // nested paths
  const obj7 = {a: 4, b: {c: 3}};
  const obj8 = {a: 4, b: {c: 4}};
  const obj9 = {a: 5, b: {d: 4}};

  diff(obj7, obj8);
  [
    { "op": "replace", "path": ['b', 'c'], "value": 4 }
  ]

  diff(obj8, obj9);
  [
    { "op": "replace", "path": ['a'], "value": 5 }
    { "op": "remove", "path": ['b', 'c']}
    { "op": "add", "path": ['b', 'd'], "value": 4 }
  ]
*/

function diff(obj1, obj2, pathConverter) {
  if (!obj1 || typeof obj1 != 'object' || !obj2 || typeof obj2 != 'object') {
    throw new Error('both arguments must be objects or arrays');
  }

  pathConverter ||
    (pathConverter = function(arr) {
      return arr;
    });

  // we will gather all permutations and return the one with the fewest diffs
  var permutations = [{remove: [], replace: [], add: []}];

  function getDiff({obj1, obj2, basePath, basePathForRemoves, permutation}) {
    var obj1Keys = Object.keys(obj1);
    var obj1KeysLength = obj1Keys.length;
    var obj2Keys = Object.keys(obj2);
    var obj2KeysLength = obj2Keys.length;
    var path;

    var newPermutation;

    var lengthDelta = obj1.length - obj2.length;
    // if both objects are arrays and obj1 length > obj2 length
    // we create an additional permutation that trims obj1 from left
    if (Array.isArray(obj1) && Array.isArray(obj2) && lengthDelta > 0) {
      newPermutation = clonePermutation(permutation);
      permutations.push(newPermutation);
    }

    // trim from right
    for (var i = 0; i < obj1KeysLength; i++) {
      var key = Array.isArray(obj1) ? Number(obj1Keys[i]) : obj1Keys[i];
      if (!(key in obj2)) {
        path = basePathForRemoves.concat(key);
        permutation.remove.push({
          op: 'remove',
          path: pathConverter(path),
        });
      }
    }

    for (var i = 0; i < obj2KeysLength; i++) {
      var key = Array.isArray(obj2) ? Number(obj2Keys[i]) : obj2Keys[i];
      pushReplaces({
        key,
        obj1,
        obj2,
        path: basePath.concat(key),
        pathForRemoves: basePath.concat(key),
        permutation,
      });
    }

    // if we created a new permutation above it means we should also try trimming from left
    if (newPermutation) {
      for (var i = 0; i < lengthDelta; i++) {
        path = basePathForRemoves.concat(i);
        newPermutation.remove.push({
          op: 'remove',
          path: pathConverter(path),
        });
      }

      // now make a copy of obj1 with excess elements left trimmed and see if there any replaces
      var obj1Trimmed = obj1.slice(lengthDelta); for (var i = 0; i < obj2KeysLength; i++) {
        pushReplaces({
          key: i,
          obj1: obj1Trimmed,
          obj2,
          path: basePath.concat(i),
          // since list of removes are reversed before presenting result,
          // we need to ignore existing parent removes when doing nested removes
          pathForRemoves: basePath.concat(i + lengthDelta),
          permutation: newPermutation,
        });
      }
    }
  }

  getDiff({
    obj1,
    obj2,
    basePath: [],
    basePathForRemoves: [],
    permutation: permutations[0],
  });

  // find the shortest permutation
  var finalDiffs = permutations.sort(
    (a, b) => diffStepCount(a) > diffStepCount(b) ? 1 : -1
  )[0];

  // reverse removes since we want to maintain indexes
  return finalDiffs.remove
    .reverse()
    .concat(finalDiffs.replace)
    .concat(finalDiffs.add);

  function pushReplaces({key, obj1, obj2, path, pathForRemoves, permutation}) {
    var obj1AtKey = obj1[key];
    var obj2AtKey = obj2[key];

    if(!(key in obj1) && (key in obj2)) {
      var obj2Value = obj2AtKey;
      permutation.add.push({
        op: 'add',
        path: pathConverter(path),
        value: obj2Value,
      });
    } else if(obj1AtKey !== obj2AtKey) {
      if(Object(obj1AtKey) !== obj1AtKey ||
        Object(obj2AtKey) !== obj2AtKey || differentTypes(obj1AtKey, obj2AtKey)
      ) {
        pushReplace(path, permutation, obj2AtKey);
      } else {
        if(!Object.keys(obj1AtKey).length &&
          !Object.keys(obj2AtKey).length &&
          String(obj1AtKey) != String(obj2AtKey)) {
          pushReplace(path, permutation, obj2AtKey);
        } else {
          getDiff({
            obj1: obj1[key],
            obj2: obj2[key],
            basePath: path,
            basePathForRemoves: pathForRemoves,
            permutation});
        }
      }
    }
  }

  function pushReplace(path, diffs, newValue) {
    diffs.replace.push({
      op: 'replace',
      path: pathConverter(path),
      value: newValue,
    });
  }
}

function clonePermutation(permutation) {
  return {
    remove: permutation.remove.slice(0),
    replace: permutation.replace.slice(0),
    add: permutation.add.slice(0),
  };
}

function diffStepCount(permutation) {
  return permutation.remove.length + permutation.replace.length + permutation.add.length;
}

function jsonPatchPathConverter(arrayPath) {
  return [''].concat(arrayPath).join('/');
}

function differentTypes(a, b) {
  return Object.prototype.toString.call(a) != Object.prototype.toString.call(b);
}

export {diff, jsonPatchPathConverter};
