import React from 'react';
import * as DraftConvert from 'draft-convert';

import { HTMLConfig as InlineAttachmentHTMLConfig } from './inline-attachment-plugin';
import { HTMLConfig as LinkifyHTMLConfig } from './linkify-plugin';
import { HTMLConfig as TextStyleHTMLConfig } from './text-style-plugin';
import { HTMLConfig as QuotedTextHTMLConfig, withinQuotedText } from './quoted-text-plugin';
import { HTMLConfig as TemplatesHTMLConfig } from './templates-plugin';

const plugins = [
  InlineAttachmentHTMLConfig,
  LinkifyHTMLConfig,
  TextStyleHTMLConfig,
  QuotedTextHTMLConfig,
  TemplatesHTMLConfig,
];

// Conversion to and from HTML

function DOMBuilder(html) {
  var parser = new DOMParser();
  let doc = parser.parseFromString(html, 'text/html');
  if (doc === null || doc.body === null) {
    doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = html;
  }

  // strip tags that cause unwanted whitespace
  const invisibleNames = ['META'];
  const invisibleWalker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => {
      return invisibleNames.includes(node.nodeName)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const results = [];
  while (invisibleWalker.nextNode()) results.push(invisibleWalker.currentNode);
  results.forEach(r => r.remove());

  // remove extra leading and trailing spaces from text nodes
  const treeWalker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (treeWalker.nextNode()) {
    const cn = treeWalker.currentNode;
    const s = cn.textContent.startsWith(' ') || cn.textContent.startsWith('\n');
    const e = cn.textContent.endsWith(' ') || cn.textContent.endsWith('\n');
    const ct = cn.textContent.trim();
    if (s && e && ct.length > 0) {
      cn.textContent = ' ' + ct + ' ';
    } else if (s) {
      cn.textContent = ' ' + ct;
    } else if (e) {
      cn.textContent = ct + ' ';
    } else {
      cn.textContent = ct;
    }
  }

  // convert <div><br><div> into just <div> </div> to avoid double-newlines
  const brWalker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => {
      if (
        node.nodeName === 'DIV' &&
        node.childNodes.length === 1 &&
        node.childNodes[0].nodeName === 'BR'
      ) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  while (brWalker.nextNode()) {
    brWalker.currentNode.innerHTML = ' ';
  }
  return doc.body;
}

export function convertFromHTML(html) {
  return DraftConvert.convertFromHTML({
    htmlToStyle: (nodeName, node, currentStyle) => {
      let nextStyle = currentStyle;
      for (const p of plugins) {
        nextStyle = p.htmlToStyle ? p.htmlToStyle(nodeName, node, nextStyle) : nextStyle;
      }
      return nextStyle;
    },
    htmlToBlock: (nodeName, node) => {
      // once we're inside a blockquote for quoted text, we don't
      // create any new blocks, since it'd bump you out of the quoted text.
      if (withinQuotedText(node)) {
        return;
      }

      for (const p of plugins) {
        const result = p.htmlToBlock && p.htmlToBlock(nodeName, node);
        if (result) {
          return result;
        }
      }
    },
    htmlToEntity: (nodeName, node, createEntity) => {
      if (withinQuotedText(node)) {
        return QuotedTextHTMLConfig.htmlToEntity(nodeName, node, createEntity);
      }
      for (const p of plugins) {
        const result = p.htmlToEntity && p.htmlToEntity(nodeName, node, createEntity);
        if (result) return result;
      }
    },
  })(html, { flat: false }, DOMBuilder);
}

export function convertToHTML(contentState) {
  return DraftConvert.convertToHTML({
    styleToHTML: style => {
      switch (style) {
        case 'BOLD':
          return <strong />;
        case 'ITALIC':
          return <em />;
        case 'UNDERLINE':
          return <u />;
        case 'CODE':
          return <code />;
        default:
          for (const p of plugins) {
            const result = p.styleToHTML && p.styleToHTML(style);
            if (result) return result;
          }
          return <span />;
      }
    },
    blockToHTML: block => {
      switch (block.type) {
        case 'unstyled':
          if (block.text === ' ' || block.text === '') return <br />;
          return <div />;
        case 'paragraph':
          return <p />;
        case 'header-one':
          return <h1 />;
        case 'header-two':
          return <h2 />;
        case 'header-three':
          return <h3 />;
        case 'header-four':
          return <h4 />;
        case 'header-five':
          return <h5 />;
        case 'header-six':
          return <h6 />;
        case 'code-block':
          return <pre />;
        case 'blockquote':
          return <blockquote />;
        case 'unordered-list-item':
          return {
            element: <li />,
            nest: <ul />,
          };
        case 'ordered-list-item':
          return {
            element: <li />,
            nest: <ol />,
          };
        case 'media':
          return <figure />;
        case 'atomic':
          for (const p of plugins) {
            const result = p.blockToHTML && p.blockToHTML(block);
            if (result) return result;
          }
          return {
            start: '',
            end: '',
          };
        default:
          return '';
      }
    },
    entityToHTML: (entity, originalText) => {
      for (const p of plugins) {
        const result = p.entityToHTML && p.entityToHTML(entity, originalText);
        if (result) return result;
      }
      return originalText;
    },
  })(contentState);
}
