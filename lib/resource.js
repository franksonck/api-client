const {NotFoundError, EtagError} = require('./exceptions');

const resourceSymbol = Symbol('resource');

const itemPrototype = {
  save: function save(overwriteIfChanged = false) {
    return this[resourceSymbol].put(this._id, this, {overwriteIfChanged, etag: this._etag});
  },

  del: function del(overwriteIfChanged = false) {
    return this[resourceSymbol].del(this._id, {overwriteIfChanged, etag: this._etag});
  }
};

function createItem(resource, content) {
  return Object.assign(
    Object.create(
      itemPrototype, // set itemPrototype up there as prototype
      {
        [resourceSymbol]: {value: resource, configurable: false, enumerable: false},
      }
    ),
    content
  );
}

function forceWrite(instance, method, id, content) {
  return instance.get(id)
    .then((current) => {
      if (current === null) {
        throw new Error(`Tried to ${method} non existent ${instance.name}/${id}`);
      } else {
        return instance.strategy[method](instance.name, id, content, current._etag);
      }
    });
}

const readMethods = {
  get: function (id) {
    return this.strategy.get(this.name, id)
      .then((res) => {
        if (res.ok) {
          return createItem(this, res.body);
        }
      });
  },

  list: function list(filter) {
    return this.strategy.getAll(this.name, filter)
      .then((res) => {
        return res.body._items.map((item) => createItem(this, item));
      });
  },

  find: function find(filter) {
    return this.list(filter);
  }
};

const writeMethods = {
  create(content) {
    return this.strategy.post(this.name, content)
    // request won't start without then call
    // if this empty then was not there, the post request would
    // never be made if then was never called on the Promise
      .then(null, null);
  },

  post(content) {
    return this.create(content);
  },

  patch: function patch(id, content, options) {
    options = options || {};
    const {overwriteIfChanged, etag} = options;

    if (etag) {
      // if we got an etag, we can try to directly patch
      return this.strategy.patch(this.name, id, content, etag)
        .catch((err) => {
          // EVE Python gives back status code 428 if the etag
          // was not up to date
          if (err instanceof EtagError && overwriteIfChanged) {
            // In this case, we just try patching again with the new etag
            return forceWrite(this, 'patch', id, content);
          }
          throw err;
        });
    } else if (overwriteIfChanged) {
      return forceWrite(this, 'patch', id, content);
    } else {
      throw new Error('Either set overwriteIfChanged to true or provide etag');
    }
  },


  put(id, content, options) {
    options = options || {};
    const {overwriteIfChanged, etag} = options;

    if (etag) {
      // if we got an etag, we can try to directly patch
      return this.strategy.put(this.name, id, content, etag)
        .catch((err) => {
          // EVE Python gives back status code 428 if the etag
          // was not up to date
          if (err instanceof EtagError && overwriteIfChanged) {
            // In this case, we just try patching again with the new etag
            return forceWrite(this, 'put', id, content);
          }
          throw err;
        });
    } else if (overwriteIfChanged) {
      return forceWrite(this, 'put', id, content);
    } else {
      throw new Error('Either set overwriteIfChanged to true or provide etag');
    }
  }
};

function resource(name, strategy, readOnly) {
  const resource = {name, strategy};
  Object.assign(resource, readMethods);
  if (!readOnly) Object.assign(resource, writeMethods);

  return resource;
}

module.exports = resource;
