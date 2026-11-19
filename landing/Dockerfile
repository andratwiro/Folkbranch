# The folkbranch.com site: static pages behind nginx. Deploy from this folder:
#   railway up --project <project> --environment production --service landing --ci
FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/site.conf
COPY site/ /usr/share/nginx/html/
